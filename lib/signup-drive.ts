import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

// Sign-up drive links.
//
// The public registration form is rate-limited to 10 submissions per hour per
// connection — right for a household, fatal for a school sign-up drive, where
// a hundred families register on the school's one Wi-Fi (or a volunteer's
// laptop) in an afternoon: the 11th was refused. A drive link is a normal
// registration link carrying a signed, short-lived token a centre manager
// issued. With it the per-connection limit rises for that drive; the drive has
// its own ceiling; and the school can be filled in for every family.
//
// Signed with JWT_SECRET under its own audience, so it can never be replayed
// as a session. Stateless: it simply expires.

const AUDIENCE = "signup-drive";
export const DRIVE_MAX_DAYS = 14;
// Per connection, per hour, while the drive link is used.
export const DRIVE_LIMIT_PER_CONNECTION = 300;
// Across the whole drive, per hour — a leaked link still can't flood the queue.
export const DRIVE_LIMIT_TOTAL = 600;

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export type Drive = { driveId: string; centreId: string; school: string | null; expiresAt: Date };

export async function createDriveToken(opts: { centreId: string; school?: string | null; days: number }) {
  const days = Math.min(Math.max(1, Math.round(opts.days)), DRIVE_MAX_DAYS);
  const expiresAt = new Date(Date.now() + days * 86400_000);
  const driveId = crypto.randomBytes(6).toString("base64url");
  const token = await new SignJWT({ c: opts.centreId, s: opts.school?.trim() || null, d: driveId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
  return { token, driveId, expiresAt };
}

/** The drive a token belongs to, or null if it's missing, forged, expired or for another centre. */
export async function readDriveToken(token: unknown, centreId: string): Promise<Drive | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 1000) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: AUDIENCE });
    if (payload.c !== centreId || typeof payload.d !== "string" || !payload.exp) return null;
    return {
      driveId: payload.d,
      centreId,
      school: typeof payload.s === "string" && payload.s ? payload.s : null,
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch {
    return null;
  }
}
