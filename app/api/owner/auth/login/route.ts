import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { emailIdentity } from "@/lib/email-normalize";
import { prisma } from "@/lib/prisma";
import {
  isOwner,
  setOwnerSessionCookie,
  signOwnerSession,
  verifyOwnerPassword,
} from "@/lib/owner-auth";
import { verifyTotpWithStep, consumeRecoveryCode } from "@/lib/totp";
import { peekRate, recordFailure, clearRate, clientFingerprint } from "@/lib/rate-limit";

const schema = z.object({
  email: emailIdentity(),
  password: z.string().min(1),
  totp: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(8).max(40).optional(),
});

// POST /api/owner/auth/login — authenticate a PlatformUser and set the owner
// cookie. Distinct from /api/auth/login (which authenticates tenant Users).
// If the user has 2FA enabled, a valid TOTP code MUST be supplied; otherwise
// we respond with 401 { error: "TOTP_REQUIRED" } so the client knows to
// surface the second-factor input.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  // Tighter limits than the tenant login — owner accounts are higher-value
  // targets and the user base is far smaller (legit traffic is low). Failures
  // only, cleared on success, same as the tenant path.
  const WINDOW_MS = 15 * 60_000;
  const ipKey = `owner-login:ip:${clientFingerprint(req)}`;
  const emailKey = `owner-login:em:${parsed.data.email}`;

  async function failCredentials() {
    await Promise.all([recordFailure(ipKey, WINDOW_MS), recordFailure(emailKey, WINDOW_MS)]);
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  for (const [key, limit] of [[ipKey, 10], [emailKey, 5]] as const) {
    const check = await peekRate(key, limit, WINDOW_MS);
    if (!check.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", retryAfterSec: check.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(check.retryAfterSec) } },
      );
    }
  }

  const user = await prisma.platformUser.findUnique({ where: { email: parsed.data.email } });
  if (!user || user.status !== "active") return failCredentials();
  const ok = await verifyOwnerPassword(parsed.data.password, user.passwordHash);
  if (!ok) return failCredentials();

  if (!isOwner(user.role)) {
    return NextResponse.json(
      { error: "ROLE_INVALID", message: "Your platform role is misconfigured — please contact support." },
      { status: 500 },
    );
  }

  if (user.twoFactor && user.totpSecret) {
    if (parsed.data.recoveryCode) {
      // Recovery-code path: matches against the stored hashes, removes the
      // used code, and proceeds without a TOTP step. Audit + flag for the
      // user to re-enrol after the rescue.
      const { matched, remainingHashes } = consumeRecoveryCode(
        user.totpRecoveryCodesJson,
        parsed.data.recoveryCode,
      );
      if (!matched) {
        await Promise.all([recordFailure(ipKey, WINDOW_MS), recordFailure(emailKey, WINDOW_MS)]);
        return NextResponse.json({ error: "RECOVERY_INVALID" }, { status: 401 });
      }
      await prisma.platformUser.update({
        where: { id: user.id },
        // jsonb column: pass the array directly. `null` means "all codes used —
        // clear the column" which maps to Prisma.DbNull on a nullable Json field.
        data: { totpRecoveryCodesJson: remainingHashes ?? Prisma.DbNull },
      });
      await prisma.platformAuditLog.create({
        data: { actorId: user.id, action: "owner.2fa_recovery_used" },
      });
    } else {
      if (!parsed.data.totp) {
        return NextResponse.json({ error: "TOTP_REQUIRED" }, { status: 401 });
      }
      const step = verifyTotpWithStep(user.totpSecret, parsed.data.totp);
      if (step === null) {
        await Promise.all([recordFailure(ipKey, WINDOW_MS), recordFailure(emailKey, WINDOW_MS)]);
        return NextResponse.json({ error: "TOTP_INVALID" }, { status: 401 });
      }
      // Replay protection — a code that matched at counter step N can
      // never authenticate again. Each successful login must strictly
      // advance the stored step.
      if (user.totpLastStep !== null && step <= user.totpLastStep) {
        await Promise.all([recordFailure(ipKey, WINDOW_MS), recordFailure(emailKey, WINDOW_MS)]);
        return NextResponse.json({ error: "TOTP_REPLAY" }, { status: 401 });
      }
      await prisma.platformUser.update({
        where: { id: user.id },
        data: { totpLastStep: step },
      });
    }
  }

  // Signed in — forgive this account's earlier fumbles. The IP counter stands.
  await clearRate(emailKey);

  const token = await signOwnerSession({
    ownerId: user.id,
    role: user.role,
    name: user.name,
    tokenVersion: user.tokenVersion,
  });
  await setOwnerSessionCookie(token);
  return NextResponse.json({ ok: true, redirect: "/owner" });
}
