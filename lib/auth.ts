import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import type { Role } from "./roles";
import { bindTenantOrg } from "./tenant-context";
import { redirect } from "next/navigation";

const COOKIE_NAME = "ew_session";

export type SessionPayload = {
  userId: string;
  role: Role;
  centreId: string | null;
  name: string;
  // Snapshot of User.tokenVersion when the JWT was minted. The session
  // resolver compares this against the row's current tokenVersion on every
  // request — when they diverge, the JWT is rejected. Bumped on password
  // reset and explicit "sign out everywhere".
  tokenVersion?: number;
  // Set when a platform OWNER_ADMIN has impersonated this tenant user. The
  // value is the PlatformUser.id of the impersonator; clearing the session
  // restores the owner's own session via /api/owner/impersonate/stop.
  impersonatedBy?: string;
  // Epoch ms — non-null means the impersonation expires when Date.now()
  // crosses this. Independent of JWT exp so we can show a countdown in UI.
  impersonationExpiresAt?: number;
};

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

// DEFERRED — refresh-token rotation (#20): we currently mint a single
// short-lived access JWT (default 60 min) and rely on the user signing in
// again at expiry. The mature pattern is a separate refresh token, stored
// hashed server-side, rotated on every use, and revocable independently of
// the access token. We get partial coverage via tokenVersion (forced
// global signout, password reset). Add when usage feedback shows the 60min
// expiry friction is a problem.
export async function signSession(payload: SessionPayload) {
  const ttlMin = Number(process.env.JWT_ACCESS_TTL_MIN ?? 480);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlMin}m`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const ttlMin = Number(process.env.JWT_ACCESS_TTL_MIN ?? 480);
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    // sameSite "lax" — sent on top-level navigations (so opening the app
    // from a WhatsApp/email link keeps you logged in) but not on cross-site
    // sub-requests, which still blocks the standard CSRF class.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlMin * 60,
  });
}

export async function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}

// React.cache() memoises this function for the lifetime of ONE server
// request. Layout + page + components on the same render all call
// getSession() independently — without cache(), every one triggers the
// JWT verify + the tokenVersion DB lookup. With cache(), it happens
// once. New requests get a fresh cache (no cross-user leak).
//
// Critical for free-tier perf: a typical admin page render can call
// getSession 5-10 times via layout/page/Sidebar/Topbar/feature gates.
// Deduping saves 4-9 DB round-trips per render.
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  // tokenVersion check — JWT carries the version it was minted at; if the
  // user row has been bumped past it, the session is dead. Implemented here
  // (not in verifySession) so the JWT signature check stays pure/edge-safe.
  // The same query also enforces the tenant-org suspended block: if the
  // user's org (via centre OR User.orgId for HQ users) is suspended, the
  // session is dead and the user is logged out platform-wide. Only legacy
  // SUPER_ADMINs with no orgId yet (pre-backfill) skip the org check.
  // Run the DB re-check for normal sessions (which carry a tokenVersion) AND
  // for impersonation sessions (which don't): otherwise an impersonated session
  // bypassed the suspended-user / suspended-org / pending-deletion checks for
  // its whole 30-min life. The tokenVersion EQUALITY check only applies when a
  // version is present — impersonation tokens are minted without one.
  if (typeof payload.tokenVersion === "number" || payload.impersonatedBy) {
    const { prisma } = await import("./prisma");
    const u = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        tokenVersion: true,
        status: true,
        deletionRequestedAt: true,
        orgId: true,
        centre: { select: { orgId: true, org: { select: { status: true } } } },
        org: { select: { status: true } },
      },
    });
    if (!u || u.status !== "active") return null;
    if (typeof payload.tokenVersion === "number" && u.tokenVersion !== payload.tokenVersion) return null;
    // DPDPA: pending-deletion sessions are dead. The cancel endpoint uses
    // the raw cookie verification (not getSession) so a user can still
    // withdraw their own request during the grace window.
    if (u.deletionRequestedAt) return null;
    const orgStatus = u.centre?.org?.status ?? u.org?.status;
    if (orgStatus === "suspended") return null;
    // RLS backstop: bind this request's org for the Postgres policies. getSession
    // is the one chokepoint EVERY authenticated route + page hits, so binding
    // here means even API routes that only filter by centreId in app-code (and
    // never call getOrgIdForSession) still run inside the org-scoped policies
    // under RLS_ENFORCE=1. No-op when the flag is off. Parent/Rider portals
    // (whose org comes from links, not User.orgId) re-bind in their resolvers.
    bindTenantOrg(u.orgId ?? u.centre?.orgId ?? null);
  }
  // Honour explicit impersonation expiry too — separate from JWT exp so we
  // can cap impersonated sessions to 30 min regardless of the JWT TTL.
  if (payload.impersonationExpiresAt && Date.now() > payload.impersonationExpiresAt) {
    return null;
  }
  return payload;
});

// Page guard: return the session, or bounce to /login. Use this in every
// server COMPONENT instead of `(await getSession())!`.
//
// The middleware only verifies the JWT signature and expiry. getSession() then
// applies six further checks the cookie cannot know about, any of which turns a
// structurally valid cookie into a null session mid-flight:
//   • the user was deleted, or deactivated
//   • tokenVersion moved on — "sign out everywhere", or a password reset
//   • the user requested account deletion (DPDPA grace window)
//   • the ORG was suspended — i.e. the club stopped paying
//   • an impersonation window expired
// With the old non-null assertion, every one of those rendered a TypeError on
// the server and dumped the user on a blank bounce with no explanation. That is
// not a rare edge: a club suspended for non-payment hits it on every request,
// and it floods error reporting at exactly the moment someone is looking.
//
// Deliberately NOT for API routes — they must answer 401 JSON, not redirect.
export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) redirect("/login?ended=1");
  return s;
}

// Layout helper: returns true when the signed-in user is still on a
// server-generated temp password. Each portal's layout calls this and
// redirects to /account/rotate to enforce a fresh password before the user
// can navigate anywhere else.
export async function shouldForceRotate(userId: string): Promise<boolean> {
  // Local import avoids a circular dependency at module load.
  const { prisma } = await import("./prisma");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { mustChangePassword: true },
  });
  return !!u?.mustChangePassword;
}

export { COOKIE_NAME };
