// Shared post-authentication ceremony for BOTH sign-in paths (password login
// and passwordless email-OTP login). Centralised so the 2FA gate and session
// minting can never drift between the two — a divergence here would be a 2FA
// bypass or a session-claims mismatch.
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { signSession, setSessionCookie } from "./auth";
import { verifyTotp, hashRecoveryCode } from "./totp";
import { isRole } from "./roles";

export type SignInUser = {
  id: string;
  role: string;
  centreId: string | null;
  name: string;
  tokenVersion: number;
  twoFactor: boolean;
  totpSecret: string | null;
  totpRecoveryCodesJson: unknown;
  mustChangePassword: boolean;
};

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
  if (supplied && verifyTotp(user.totpSecret, supplied)) return null;

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
export async function finishSignIn(user: SignInUser): Promise<NextResponse> {
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

  // Force-rotation when HQ generated a temp password (create/reset/forgot).
  if (user.mustChangePassword) return NextResponse.json({ ok: true, redirect: "/account/rotate" });
  return NextResponse.json({ ok: true, redirect: roleRedirect(user.role) });
}
