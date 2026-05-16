// Owner-portal forgot-password mechanics. Mirrors lib/password-reset.ts but
// keyed on PlatformUser instead of User — separate auth domain, separate
// token table, so a tenant-side leak cannot mint owner tokens.

import crypto from "node:crypto";
import { prisma } from "./prisma";

export const OWNER_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export function hashOwnerToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

export async function issueOwnerResetToken(
  ownerId: string,
  requestedIp?: string | null,
): Promise<string> {
  const plain = crypto.randomBytes(24).toString("base64url");
  await prisma.ownerPasswordResetToken.create({
    data: {
      ownerId,
      tokenHash: hashOwnerToken(plain),
      expiresAt: new Date(Date.now() + OWNER_RESET_TOKEN_TTL_MS),
      requestedIp: requestedIp ?? null,
    },
  });
  return plain;
}

export async function redeemOwnerResetToken(
  plain: string,
): Promise<{ ok: true; ownerId: string } | { ok: false; error: string }> {
  const tokenHash = hashOwnerToken(plain);
  const row = await prisma.ownerPasswordResetToken.findUnique({ where: { tokenHash } });
  if (!row) return { ok: false, error: "INVALID_TOKEN" };
  if (row.usedAt) return { ok: false, error: "TOKEN_USED" };
  if (row.expiresAt < new Date()) return { ok: false, error: "TOKEN_EXPIRED" };

  const claim = await prisma.ownerPasswordResetToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, error: "TOKEN_USED" };

  return { ok: true, ownerId: row.ownerId };
}
