// Email verification mechanics — 6-digit OTP sent by email.
//   • Plaintext 6-digit code sent over email.
//   • SHA-256 hash persisted, never the plaintext.
//   • Single-use, 10-minute TTL — short-lived since it's a small guessable
//     space (unlike the password-reset/old-link tokens, which are large
//     random values that can stay valid for longer).
//   • Max 5 verify attempts per issued code; exceeding it requires a fresh
//     code (issuing one invalidates any still-live code for the same user).
//
// Issued during super-admin signup (lib/tenant-provision.ts) and any
// future email-change flow. Verification consumes the row and stamps
// User.emailVerifiedAt.

import crypto from "node:crypto";
import { prisma } from "./prisma";

export const VERIFY_CODE_TTL_MS = 10 * 60 * 1000;
export const VERIFY_MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// Zero-padded 6-digit string ("000000"–"999999"), drawn from a CSPRNG.
function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function issueEmailVerifyCode(userId: string, email: string): Promise<string> {
  // Invalidate any still-live code for this user first, so only one code is
  // ever guessable at a time — requesting a new code retires the old one
  // rather than letting both stay valid.
  await prisma.emailVerifyToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = generateCode();
  await prisma.emailVerifyToken.create({
    data: {
      userId,
      email,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + VERIFY_CODE_TTL_MS),
    },
  });
  return code;
}

export async function redeemEmailVerifyCode(
  email: string,
  code: string,
): Promise<{ ok: true; userId: string; email: string } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  // Don't distinguish "no such user" from "no live code" — both look like an
  // invalid code to the caller.
  if (!user) return { ok: false, error: "INVALID_CODE" };

  const row = await prisma.emailVerifyToken.findFirst({
    where: { userId: user.id, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, error: "INVALID_CODE" };
  if (row.expiresAt < new Date()) return { ok: false, error: "CODE_EXPIRED" };
  if (row.attempts >= VERIFY_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };

  if (hashCode(code) !== row.codeHash) {
    await prisma.emailVerifyToken.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, error: "INVALID_CODE" };
  }

  // Atomic single-use guard — same idea as the old token flow, in case of a
  // concurrent double-submit.
  const update = await prisma.emailVerifyToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (update.count === 0) return { ok: false, error: "CODE_USED" };

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date() },
  });

  return { ok: true, userId: user.id, email: row.email };
}

// Passwordless-login variant: validate a code WITHOUT consuming it, returning
// the token id so the caller can consume it only after any second factor (TOTP)
// also passes. This prevents a 2FA account's code from being burned when the
// user still has to enter their authenticator code. Wrong codes still increment
// the attempt counter (the 5-try lockout applies), and expiry/lockout are
// enforced — the only difference from redeem is it doesn't mark usedAt or stamp
// emailVerifiedAt.
export async function peekEmailVerifyCode(
  email: string,
  code: string,
): Promise<{ ok: true; userId: string; tokenId: string } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { ok: false, error: "INVALID_CODE" };

  const row = await prisma.emailVerifyToken.findFirst({
    where: { userId: user.id, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, error: "INVALID_CODE" };
  if (row.expiresAt < new Date()) return { ok: false, error: "CODE_EXPIRED" };
  if (row.attempts >= VERIFY_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };

  if (hashCode(code) !== row.codeHash) {
    await prisma.emailVerifyToken.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "INVALID_CODE" };
  }
  return { ok: true, userId: user.id, tokenId: row.id };
}

// Email-CHANGE variant. The pending new address rides in the token's `email`
// column (issueEmailVerifyCode(userId, newEmail)); User.email is left untouched
// until the code is confirmed, so login keeps working on the old address in the
// meantime. On success we switch User.email to the token's address and stamp
// emailVerifiedAt, consuming the token — all in one transaction so a duplicate
// email (claimed by someone else between request and confirm) rolls the switch
// back rather than half-applying it.
export async function redeemEmailChange(
  userId: string,
  code: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const row = await prisma.emailVerifyToken.findFirst({
    where: { userId, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, error: "INVALID_CODE" };
  if (row.expiresAt < new Date()) return { ok: false, error: "CODE_EXPIRED" };
  if (row.attempts >= VERIFY_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
  if (hashCode(code) !== row.codeHash) {
    await prisma.emailVerifyToken.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "INVALID_CODE" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerifyToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count === 0) return { ok: false as const, error: "CODE_USED" };
      // The @unique on User.email is the backstop: if the address was taken
      // since the request, this throws P2002 and the whole tx rolls back.
      await tx.user.update({
        where: { id: userId },
        data: { email: row.email, emailVerifiedAt: new Date() },
      });
      return { ok: true as const, email: row.email };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { ok: false, error: "EMAIL_TAKEN" };
    throw err;
  }
}

// Mark a peeked code used (single-use guard) + stamp emailVerifiedAt. Returns
// false if it was already consumed by a concurrent request.
export async function consumeEmailVerifyCode(tokenId: string, userId: string): Promise<boolean> {
  const update = await prisma.emailVerifyToken.updateMany({
    where: { id: tokenId, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (update.count === 0) return false;
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  return true;
}
