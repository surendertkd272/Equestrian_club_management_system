// Email verification mechanics. Mirrors lib/password-reset.ts:
//   • Plaintext 24-byte base64url token sent over email.
//   • SHA-256 hash persisted, never the plaintext.
//   • Single-use, 7-day TTL — verification is less time-sensitive than
//     a password reset.
//
// Issued during super-admin signup (lib/tenant-provision.ts) and any
// future email-change flow. Verification consumes the token and stamps
// User.emailVerifiedAt.

import crypto from "node:crypto";
import { prisma } from "./prisma";

export const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

export async function issueEmailVerifyToken(userId: string, email: string): Promise<string> {
  const plain = crypto.randomBytes(24).toString("base64url");
  await prisma.emailVerifyToken.create({
    data: {
      userId,
      email,
      tokenHash: hashToken(plain),
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    },
  });
  return plain;
}

export async function redeemEmailVerifyToken(
  plain: string,
): Promise<{ ok: true; userId: string; email: string } | { ok: false; error: string }> {
  const tokenHash = hashToken(plain);
  const row = await prisma.emailVerifyToken.findUnique({ where: { tokenHash } });
  if (!row) return { ok: false, error: "INVALID_TOKEN" };
  if (row.usedAt) return { ok: false, error: "TOKEN_USED" };
  if (row.expiresAt < new Date()) return { ok: false, error: "TOKEN_EXPIRED" };

  // Atomic single-use guard.
  const update = await prisma.emailVerifyToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (update.count === 0) return { ok: false, error: "TOKEN_USED" };

  await prisma.user.update({
    where: { id: row.userId },
    data: { emailVerifiedAt: new Date() },
  });

  return { ok: true, userId: row.userId, email: row.email };
}
