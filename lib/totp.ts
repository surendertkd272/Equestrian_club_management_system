// Minimal RFC-6238 TOTP. Avoids pulling in a heavy dep — we only need:
//   1. generate a base32 secret
//   2. produce the otpauth:// URL that authenticator apps consume
//   3. verify a 6-digit code with a small ±1 step skew tolerance
//
// SHA-1 / 30s / 6-digit defaults match Google Authenticator + Authy + 1Password.

import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = BASE32_ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("INVALID_BASE32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

// otpauth://totp/Equiwings:owner@x.local?secret=AAA&issuer=Equiwings
export function otpauthUrl(opts: { secret: string; label: string; issuer: string }): string {
  const qs = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.label)}?${qs.toString()}`;
}

function hotp(secret: Buffer, counter: bigint): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

export function generateTotp(secretBase32: string, when = new Date()): string {
  const counter = BigInt(Math.floor(when.getTime() / 30_000));
  return hotp(base32Decode(secretBase32), counter);
}

// ±1 step tolerance (30s before/after) absorbs clock drift on the user's
// phone. Anything larger is a 2FA-bypass risk.
export function verifyTotp(secretBase32: string, code: string, when = new Date()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  const counter = BigInt(Math.floor(when.getTime() / 30_000));
  for (const delta of [-1n, 0n, 1n]) {
    if (hotp(secret, counter + delta) === code) return true;
  }
  return false;
}

// Replay-aware verification. Returns the counter step the code matched, or
// null if it didn't. Callers should persist the returned step and reject
// any future attempt whose match-step is ≤ the persisted value, so a
// stolen-but-not-yet-expired code can't be reused.
export function verifyTotpWithStep(
  secretBase32: string,
  code: string,
  when = new Date(),
): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const counter = BigInt(Math.floor(when.getTime() / 30_000));
  for (const delta of [-1n, 0n, 1n]) {
    const step = counter + delta;
    if (hotp(secret, step) === code) return step;
  }
  return null;
}

// Recovery codes — single-use backup keys printed at enrollment for the
// "lost my authenticator" case. We store SHA-256 hashes, not plaintext, so
// a DB leak doesn't hand an attacker working second factors.

export function generateRecoveryCodes(n = 8): string[] {
  // 10 chars from a hex alphabet — plenty of entropy, easy to read aloud.
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(crypto.randomBytes(5).toString("hex"));
  }
  return out;
}

export function hashRecoveryCode(plain: string): string {
  return crypto.createHash("sha256").update(plain.trim().toLowerCase()).digest("hex");
}

// Consume a recovery code from a stored hash list. Accepts either a string
// (legacy / tests) or a parsed JsonValue (native jsonb column). Returns the
// remaining hashes (caller persists as-is — Prisma accepts the array directly
// for a Json column) and whether the input matched. `remainingHashes === null`
// means "clear the column" (caller maps that to Prisma.DbNull).
export function consumeRecoveryCode(
  stored: unknown,
  input: string,
): { matched: boolean; remainingHashes: string[] | null } {
  // Coerce the stored value into a string[] of hashes regardless of how it
  // was persisted historically (string blob vs jsonb array).
  let hashes: string[] = [];
  if (stored !== null && stored !== undefined && stored !== "") {
    try {
      const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
      if (Array.isArray(parsed)) hashes = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      return { matched: false, remainingHashes: hashes };
    }
  }
  if (hashes.length === 0) return { matched: false, remainingHashes: null };
  const target = hashRecoveryCode(input);
  const idx = hashes.indexOf(target);
  if (idx < 0) return { matched: false, remainingHashes: hashes };
  hashes.splice(idx, 1);
  return { matched: true, remainingHashes: hashes.length === 0 ? null : hashes };
}
