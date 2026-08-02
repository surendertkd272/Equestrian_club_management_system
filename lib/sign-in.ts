// Shared post-authentication ceremony for BOTH sign-in paths (password login
// and passwordless email-OTP login). Centralised so the 2FA gate and session
// minting can never drift between the two — a divergence here would be a 2FA
// bypass or a session-claims mismatch.
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { signSession, setSessionCookie } from "./auth";
import { verifyTotpWithStep, hashRecoveryCode } from "./totp";
import { isRole } from "./roles";
import { deletionScheduledFor } from "./dpdpa";

export type SignInUser = {
  id: string;
  role: string;
  centreId: string | null;
  name: string;
  tokenVersion: number;
  twoFactor: boolean;
  totpSecret: string | null;
  totpRecoveryCodesJson: unknown;
  totpLastStep: bigint | null;
  email: string;
  emailVerifiedAt: Date | null;
  mustChangePassword: boolean;
  deletionRequestedAt: Date | null;
};

// Account-state gate — conditions that make a sign-in impossible even when the
// credentials are perfectly correct.
//
// Call this as soon as the user row is loaded and BEFORE consuming any
// one-shot credential (the emailed sign-in code), so a refused sign-in doesn't
// burn something the user then needs to rescue their account with.
// finishSignIn() calls it again as a backstop, so a future sign-in path can't
// forget it.
export function accountStateGate(
  user: SignInUser,
  opts: { emailProven?: boolean } = {},
): NextResponse | null {
  // DPDPA grace window. getSession() nulls the session of a user with a
  // pending deletion, so minting a cookie for one produced a loop with no exit:
  // sign-in succeeds → every layout bounces to /login?ended=1 → sign in again.
  // Refuse the sign-in outright and hand the client the deletion date plus the
  // code it needs to offer the withdraw-my-request path
  // (POST /api/auth/cancel-deletion).
  if (user.deletionRequestedAt) {
    return NextResponse.json(
      {
        error: "DELETION_PENDING",
        scheduledFor: deletionScheduledFor(user.deletionRequestedAt).toISOString(),
      },
      { status: 403 },
    );
  }

  // Email ownership. emailVerifiedAt was written by the verify flows and read
  // by NOTHING — the whole verification round-trip was decorative. Non-null
  // means verified (the schema comment claimed the opposite; the code has
  // always been this way round).
  //
  // Only accounts that never proved their address are null: the backfill
  // migration stamped every pre-existing row, and admin-created users are
  // stamped at creation because an admin typing the address IS the check. In
  // practice that leaves the super-admin minted by tenant provisioning, who
  // gets a code emailed at creation.
  //
  // `emailProven` is how the OTP sign-in path opts out: receiving a code at
  // that address is itself the proof, so blocking it would be absurd.
  if (!user.emailVerifiedAt && !opts.emailProven) {
    return NextResponse.json({ error: "EMAIL_UNVERIFIED", email: user.email }, { status: 403 });
  }
  return null;
}

// Sign-in audit trail.
//
// Nothing wrote `auth.login_failed` before, yet lib/system-status.ts counts
// exactly that action for the ops dashboard's "failed logins (24h)" tile — so
// the tile read 0 forever, and a brute-force run against the platform was
// invisible. There was no record of successful sign-ins either: no way to
// answer "when did this account last sign in, and from where".
//
// AuditLog carries a permissive RLS policy ([global] in the full-coverage
// migration), so these writes work on the pre-auth path where no org is bound.
// audit() is best-effort and never throws back into the handler.
export async function auditSignIn(
  outcome: "succeeded" | "failed",
  info: { userId?: string | null; email: string; reason?: string; req?: Request },
): Promise<void> {
  const { audit } = await import("./audit");
  const { clientFingerprint } = await import("./rate-limit");
  await audit({
    userId: info.userId ?? null,
    action: outcome === "succeeded" ? "auth.login_succeeded" : "auth.login_failed",
    tableName: "user",
    // No row to point at when the address doesn't match an account — but the
    // attempt is still the thing worth counting.
    rowId: info.userId ?? "unknown",
    after: { email: info.email, ...(info.reason ? { reason: info.reason } : {}) },
    ip: info.req ? clientFingerprint(info.req) : null,
    userAgent: info.req?.headers.get("user-agent") ?? null,
  });
}

// Two-factor gate. Returns a NextResponse to RETURN (challenge / invalid) when
// the second factor is required-but-missing or wrong, or null when 2FA passed
// or isn't enrolled (caller proceeds to mint the session). Consumes a recovery
// code on successful recovery-code use.
export async function twoFactorGate(
  user: SignInUser,
  factor: { totpCode?: string; recoveryCode?: string },
): Promise<NextResponse | null> {
  if (!(user.twoFactor && user.totpSecret)) return null;

  const supplied = factor.totpCode;
  const recovery = factor.recoveryCode?.trim();
  if (!supplied && !recovery) {
    return NextResponse.json({ error: "TWO_FACTOR_REQUIRED" }, { status: 401 });
  }

  if (supplied) {
    // Replay-aware verification. This used to be a plain boolean verifyTotp(),
    // which meant a code observed inside its ±90s window could be replayed —
    // even though User.totpLastStep existed for exactly this and the schema
    // comment claimed the protection was in place. The owner portal did it
    // properly; the tenant path did not.
    const step = verifyTotpWithStep(user.totpSecret, supplied);
    if (step !== null) {
      if (user.totpLastStep !== null && step <= user.totpLastStep) {
        return NextResponse.json({ error: "TWO_FACTOR_REPLAY" }, { status: 401 });
      }
      // Each accepted code must strictly advance the stored step, so the one
      // just used can never authenticate again.
      await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
      return null;
    }
  }

  if (recovery && user.totpRecoveryCodesJson) {
    const stored = user.totpRecoveryCodesJson as unknown;
    const hashes: string[] = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : [];
    const matchHash = hashRecoveryCode(recovery);
    if (hashes.includes(matchHash)) {
      const remaining = hashes.filter((h) => h !== matchHash);
      await prisma.user.update({
        where: { id: user.id },
        data: { totpRecoveryCodesJson: remaining.length === 0 ? Prisma.DbNull : remaining },
      });
      return null;
    }
  }
  return NextResponse.json({ error: "TWO_FACTOR_INVALID" }, { status: 401 });
}

// Role landing page — each portal-owning role lands in its own portal; staff
// fall through to /dashboard.
export function roleRedirect(role: string): string {
  return role === "PARENT" ? "/parent"
    : role === "RIDER" ? "/student"
    : role === "SCHOOL_ADMINISTRATOR" ? "/school"
    : "/dashboard";
}

// Mint the session cookie and return the success response with a role-aware
// redirect. Assumes auth + 2FA already passed.
export async function finishSignIn(
  user: SignInUser,
  req?: Request,
  opts: { emailProven?: boolean } = {},
): Promise<NextResponse> {
  const blocked = accountStateGate(user, opts);
  if (blocked) return blocked;
  if (!isRole(user.role)) {
    return NextResponse.json(
      { error: "ROLE_INVALID", message: "Your account role is misconfigured — please contact your administrator." },
      { status: 500 },
    );
  }
  const token = await signSession({
    userId: user.id,
    role: user.role,
    centreId: user.centreId ?? null,
    name: user.name,
    tokenVersion: user.tokenVersion,
  });
  await setSessionCookie(token);
  // Audited here rather than at each call site so both sign-in paths are
  // recorded and neither can forget.
  await auditSignIn("succeeded", { userId: user.id, email: user.email, req });

  // Force-rotation when HQ generated a temp password (create/reset/forgot).
  if (user.mustChangePassword) return NextResponse.json({ ok: true, redirect: "/account/rotate" });
  return NextResponse.json({ ok: true, redirect: roleRedirect(user.role) });
}
