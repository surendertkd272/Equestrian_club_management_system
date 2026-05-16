// Magic-link token mechanics for the external-entry verification flow.
// Same pattern as lib/password-reset.ts: 24-byte base64url plaintext sent
// in the verification email; SHA-256 hash persisted. 48-hour TTL.
import crypto from "node:crypto";

export const ENTRY_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

export function hashEntryToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

export function newEntryToken(): { plain: string; hash: string; expiresAt: Date } {
  const plain = crypto.randomBytes(24).toString("base64url");
  return { plain, hash: hashEntryToken(plain), expiresAt: new Date(Date.now() + ENTRY_TOKEN_TTL_MS) };
}
