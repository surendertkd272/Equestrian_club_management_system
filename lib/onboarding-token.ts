import crypto from "node:crypto";

// The onboarding link carries a random plaintext token; we store only its
// SHA-256 hash, so a leaked DB row can't be replayed as a link.
export function hashOnboardingToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}
