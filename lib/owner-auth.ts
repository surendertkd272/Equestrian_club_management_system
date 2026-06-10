// Platform-owner auth. Mirrors lib/auth.ts but for the PlatformUser table and
// uses a separate cookie + JWT audience so an owner token can never be reused
// as a tenant session (and vice versa) even if both cookies are present.

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { bindRlsBypass } from "./tenant-context";

const OWNER_COOKIE_NAME = "ew_owner_session";
const OWNER_AUDIENCE = "owner";

export type OwnerRole = "OWNER_ADMIN" | "OWNER_EDITOR" | "OWNER_BILLING";

export type OwnerSessionPayload = {
  ownerId: string;
  role: OwnerRole;
  name: string;
  // Same purpose as User.tokenVersion in lib/auth.ts — bumped on password
  // reset / 2FA disable to invalidate every active owner session.
  tokenVersion?: number;
};

function getSecret() {
  // Prefer a dedicated owner secret so the platform-owner signing key can be
  // rotated independently of the tenant JWT_SECRET; fall back to JWT_SECRET so
  // existing deployments keep working unchanged. The OWNER_AUDIENCE claim still
  // prevents cross-use of tokens even when both share the same key.
  const secret = process.env.OWNER_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) throw new Error("Neither OWNER_JWT_SECRET nor JWT_SECRET is set");
  return new TextEncoder().encode(secret);
}

export async function hashOwnerPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyOwnerPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function signOwnerSession(payload: OwnerSessionPayload) {
  const ttlMin = Number(process.env.JWT_ACCESS_TTL_MIN ?? 60);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(OWNER_AUDIENCE)
    .setExpirationTime(`${ttlMin}m`)
    .sign(getSecret());
}

export async function verifyOwnerSession(token: string): Promise<OwnerSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { audience: OWNER_AUDIENCE });
    return payload as unknown as OwnerSessionPayload;
  } catch {
    return null;
  }
}

export async function setOwnerSessionCookie(token: string) {
  const ttlMin = Number(process.env.JWT_ACCESS_TTL_MIN ?? 60);
  cookies().set(OWNER_COOKIE_NAME, token, {
    httpOnly: true,
    // Strict — owner cookie never rides cross-site. CSRF-class attacks
    // would target the most sensitive surface so this trade is worth the
    // small UX cost (no "open from external link" navigation).
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlMin * 60,
  });
}

export async function clearOwnerSessionCookie() {
  cookies().delete(OWNER_COOKIE_NAME);
}

export async function getOwnerSession(): Promise<OwnerSessionPayload | null> {
  const token = cookies().get(OWNER_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyOwnerSession(token);
  if (!payload) return null;
  if (typeof payload.tokenVersion === "number") {
    const { prisma } = await import("./prisma");
    const u = await prisma.platformUser.findUnique({
      where: { id: payload.ownerId },
      select: { tokenVersion: true, status: true },
    });
    if (!u || u.status !== "active") return null;
    if (u.tokenVersion !== payload.tokenVersion) return null;
  }
  // Platform owner is cross-org by design — exempt this request's queries
  // from the RLS org backstop (no-op unless RLS_ENFORCE=1).
  bindRlsBypass();
  return payload;
}

export async function requireOwnerSession(): Promise<OwnerSessionPayload> {
  const s = await getOwnerSession();
  if (!s) throw new Error("UNAUTHENTICATED_OWNER");
  return s;
}

// True for OWNER_ADMIN only. Use for billing / suspend / delete actions.
export function isOwnerAdmin(role: OwnerRole): boolean {
  return role === "OWNER_ADMIN";
}

// True for any platform user. Use for read endpoints.
export function isOwner(role: unknown): role is OwnerRole {
  return role === "OWNER_ADMIN" || role === "OWNER_EDITOR" || role === "OWNER_BILLING";
}

export { OWNER_COOKIE_NAME, OWNER_AUDIENCE };
