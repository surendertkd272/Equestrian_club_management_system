// Application-level encryption for sensitive PII at rest (Aadhaar numbers
// today; PAN / bank details are the same shape and can adopt this next).
//
// AES-256-GCM envelope. Each value is encrypted with a random 96-bit IV and
// the GCM auth tag is stored alongside, so tampering is detected on decrypt.
// Ciphertext is a self-describing dotted string:
//
//     v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
//
// The "v1." prefix lets us (a) tell encrypted values from legacy plaintext
// during the migration window and (b) rotate the scheme later without
// guessing.
//
// Key: PII_ENCRYPTION_KEY — a 256-bit key as base64 (44 chars) or hex (64
// chars). Generate one with:  openssl rand -base64 32
//
// Rollout is intentionally graceful: with NO key configured, encryptPII is a
// passthrough (stores plaintext, warns once) so deploying this code changes
// nothing until the key is provisioned in every environment that shares the
// database. decryptPII always reads legacy plaintext transparently, so reads
// keep working throughout. Once the key is set everywhere, run
// scripts/backfill-aadhaar-encryption.ts to encrypt the existing rows.
//
// IMPORTANT: dev and prod here share one Supabase database, so the key MUST be
// identical in every environment — a row encrypted with key A is unreadable by
// an instance holding key B (decrypt throws). Provision the same value in
// Vercel and local .env together, then backfill.

import crypto from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function getKey(): Buffer | null {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "PII_ENCRYPTION_KEY must decode to 32 bytes (256-bit). Generate one with: openssl rand -base64 32",
    );
  }
  return key;
}

export function isEncryptedPII(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${VERSION}.`);
}

let warnedNoKey = false;

// Encrypt a plaintext value for storage. null/empty → null. With no key
// configured, returns the plaintext unchanged (and warns once) so the feature
// stays dormant until keys are provisioned everywhere.
export function encryptPII(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  if (isEncryptedPII(plain)) return plain; // already encrypted — don't double-wrap
  const key = getKey();
  if (!key) {
    if (!warnedNoKey) {
      console.warn(
        "[pii] PII_ENCRYPTION_KEY is not set — storing PII UNENCRYPTED. " +
          "Set the key in every environment sharing this database to enable encryption at rest.",
      );
      warnedNoKey = true;
    }
    return plain;
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

// Decrypt a stored value. Legacy plaintext (no "v1." prefix) is returned
// as-is so reads work during the migration window. Throws if an encrypted
// value is present but the key is missing/wrong, or if the auth tag fails
// (tampering / truncation) — callers that render UI should use decryptPIISafe.
export function decryptPII(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return null;
  if (!isEncryptedPII(stored)) return stored; // legacy plaintext
  const key = getKey();
  if (!key) {
    throw new Error("[pii] encrypted value present but PII_ENCRYPTION_KEY is not set");
  }
  const parts = stored.split(".");
  if (parts.length !== 4) throw new Error("[pii] malformed ciphertext");
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// Display-safe decrypt — never throws. Returns null on any failure (missing
// key, wrong key, tampered value) so a page renders "—" instead of crashing.
export function decryptPIISafe(stored: string | null | undefined): string | null {
  try {
    return decryptPII(stored);
  } catch {
    return null;
  }
}

// Last 4 digits of a value, for cheap masked display without decrypting the
// full number. Computed from plaintext at write time and stored separately.
export function last4(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const digits = String(plain).replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
