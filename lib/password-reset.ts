// Public forgot-password mechanics. Two routes:
//   POST /api/auth/forgot-password — accepts an email, issues a token IF the
//   email exists. Always returns 200 so we don't leak account existence.
//   POST /api/auth/reset-password    — accepts { token, newPassword },
//   marks the token used, writes the new hash, clears mustChangePassword.
//
// Token model: 24 bytes base64url ≈ 32-char plaintext. Hashed with SHA-256 at
// rest so a DB leak doesn't give an attacker working tokens. Single-use,
// 30-minute expiry. Multiple in-flight tokens per user are allowed — they
// just race; first redeem wins.

import crypto from "node:crypto";
import { prisma } from "./prisma";

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

// Generate + store a single-use reset token for the user. Returns the
// plaintext so the caller can email/SMS it. The plaintext is never persisted.
export async function issueResetToken(
  userId: string,
  requestedIp?: string | null,
): Promise<string> {
  const plain = crypto.randomBytes(24).toString("base64url");
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(plain),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      requestedIp: requestedIp ?? null,
    },
  });
  return plain;
}

// Validate + consume a token. Returns the user id on success, an error string
// on failure. Marks the token used in the same query so a race only lets one
// requester through.
export async function redeemResetToken(plain: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const tokenHash = hashToken(plain);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!row) return { ok: false, error: "INVALID_TOKEN" };
  if (row.usedAt) return { ok: false, error: "TOKEN_USED" };
  if (row.expiresAt < new Date()) return { ok: false, error: "TOKEN_EXPIRED" };

  // Atomic single-use: mark used; if the update affected zero rows another
  // racer beat us.
  const claim = await prisma.passwordResetToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, error: "TOKEN_USED" };

  return { ok: true, userId: row.userId };
}
