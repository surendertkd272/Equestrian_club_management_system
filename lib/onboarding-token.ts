import crypto from "node:crypto";

// The onboarding link carries a random plaintext token; we store only its
// SHA-256 hash (like the competition external-entry token).
export function hashOnboardingToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}
