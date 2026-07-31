// B2-B8 + C2 from docs/LOGIN_AUTH_AUDIT.md — session and second-factor
// hardening.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";
import { resetDb } from "../helpers/db";
import { mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, verifySession, COOKIE_NAME } from "@/lib/auth";
import { signOwnerSession, hashOwnerPassword } from "@/lib/owner-auth";
import { generateTotp, generateTotpSecret } from "@/lib/totp";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string; opts?: unknown }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: unknown) => cookieJar.set(name, { value, opts }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { getSession } = await import("@/lib/auth");
const { getOwnerSession } = await import("@/lib/owner-auth");

function post(handler: (r: ReturnType<typeof mockReq>) => Promise<Response>, url: string, body: unknown) {
  return handler(
    mockReq(`http://localhost${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

// ── B7 ───────────────────────────────────────────────────────────────────────

describe("token audience", () => {
  it("rejects a token signed with the right key but no audience", async () => {
    // Exactly what an owner token was before: same HS256 key, different
    // purpose. verifySession() used to accept it.
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const foreign = await new SignJWT({ userId: "u1", role: "SUPER_ADMIN", centreId: null, name: "X" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);
    expect(await verifySession(foreign)).toBeNull();
  });

  it("rejects an owner-audience token as a tenant session", async () => {
    const ownerToken = await signOwnerSession({
      ownerId: "o1",
      role: "OWNER_ADMIN",
      name: "Owner",
      tokenVersion: 0,
    });
    expect(await verifySession(ownerToken)).toBeNull();
  });

  it("accepts a properly minted tenant token", async () => {
    const t = await signSession({ userId: "u1", role: "COACH", centreId: null, name: "C" });
    expect(await verifySession(t)).not.toBeNull();
  });
});

// ── B4 / B6 ──────────────────────────────────────────────────────────────────

describe("session identity, revocation and absolute lifetime", () => {
  it("mints a jti and a session start time", async () => {
    const s = await verifySession(await signSession({ userId: "u1", role: "COACH", centreId: null, name: "C" }));
    expect(s!.jti).toBeTruthy();
    expect(typeof s!.sst).toBe("number");
  });

  it("preserves jti and sst across a re-mint", async () => {
    const first = await verifySession(await signSession({ userId: "u1", role: "COACH", centreId: null, name: "C" }));
    const second = await verifySession(await signSession(first!));
    expect(second!.jti).toBe(first!.jti);
    expect(second!.sst).toBe(first!.sst);
  });

  it("signing out kills the token server-side, not just the cookie", async () => {
    const user = await mkUser({ email: "out@club.in", password: "GoodPass1!", role: "COACH" });
    const token = await signSession({
      userId: user.id,
      role: "COACH",
      centreId: null,
      name: user.name,
      tokenVersion: user.tokenVersion,
    });
    cookieJar.set(COOKIE_NAME, { value: token });
    expect(await getSession()).not.toBeNull();

    await logout();

    // The copy an attacker kept is now worthless, which is the whole point:
    // before, deleting the cookie told the server nothing.
    cookieJar.set(COOKIE_NAME, { value: token });
    expect(await getSession()).toBeNull();
  });

  it("signing out on one device does NOT bump tokenVersion (other devices survive)", async () => {
    const user = await mkUser({ email: "onedevice@club.in", password: "GoodPass1!", role: "COACH" });
    const phone = await signSession({
      userId: user.id, role: "COACH", centreId: null, name: user.name, tokenVersion: user.tokenVersion,
    });
    const laptop = await signSession({
      userId: user.id, role: "COACH", centreId: null, name: user.name, tokenVersion: user.tokenVersion,
    });

    cookieJar.set(COOKIE_NAME, { value: laptop });
    await logout();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.tokenVersion).toBe(user.tokenVersion);

    cookieJar.set(COOKIE_NAME, { value: phone });
    expect(await getSession()).not.toBeNull();
  });

  it("refuses a session stretched past the absolute lifetime", async () => {
    const user = await mkUser({ email: "ancient@club.in", password: "GoodPass1!", role: "COACH" });
    const days = Number(process.env.SESSION_ABSOLUTE_MAX_DAYS ?? 30);
    // A session that started longer ago than the cap but whose exp keeps being
    // pushed forward by sliding renewal — the exact shape that never expired.
    cookieJar.set(COOKIE_NAME, {
      value: await signSession({
        userId: user.id,
        role: "COACH",
        centreId: null,
        name: user.name,
        tokenVersion: user.tokenVersion,
        sst: Date.now() - (days + 1) * 86_400_000,
      }),
    });
    expect(await getSession()).toBeNull();
  });
});

// ── B3 ───────────────────────────────────────────────────────────────────────

describe("owner session revocability", () => {
  async function mkOwner(tokenVersion = 0) {
    return prisma.platformUser.create({
      data: {
        email: "owner@platform.local",
        name: "Owner",
        role: "OWNER_ADMIN",
        passwordHash: await hashOwnerPassword("GoodPass1!"),
        status: "active",
        tokenVersion,
      },
    });
  }

  it("rejects an owner token minted without a tokenVersion", async () => {
    const owner = await mkOwner();
    // What /api/owner/impersonate/stop used to produce: a session that opted
    // out of the status/revocation re-check for its whole life.
    cookieJar.set("ew_owner_session", {
      value: await signOwnerSession({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name }),
    });
    expect(await getOwnerSession()).toBeNull();
  });

  it("rejects a suspended owner even mid-session", async () => {
    const owner = await mkOwner();
    cookieJar.set("ew_owner_session", {
      value: await signOwnerSession({
        ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name, tokenVersion: 0,
      }),
    });
    expect(await getOwnerSession()).not.toBeNull();
    await prisma.platformUser.update({ where: { id: owner.id }, data: { status: "suspended" } });
    expect(await getOwnerSession()).toBeNull();
  });
});

// ── B2 ───────────────────────────────────────────────────────────────────────

describe("tenant 2FA replay protection", () => {
  it("refuses a second sign-in with the same authenticator code", async () => {
    const secret = generateTotpSecret();
    const user = await mkUser({ email: "replay@club.in", password: "GoodPass1!", role: "COACH" });
    await prisma.user.update({ where: { id: user.id }, data: { twoFactor: true, totpSecret: secret } });

    const code = generateTotp(secret);
    const first = await post(login, "/api/auth/login", {
      email: "replay@club.in", password: "GoodPass1!", totpCode: code,
    });
    expect(first.status).toBe(200);

    // Same code, still inside its ±90s window. This used to sign in again.
    const second = await post(login, "/api/auth/login", {
      email: "replay@club.in", password: "GoodPass1!", totpCode: code,
    });
    expect(second.status).toBe(401);
    expect(await second.json()).toMatchObject({ error: "TWO_FACTOR_REPLAY" });
  });

  it("records the accepted step so replay has something to compare against", async () => {
    const secret = generateTotpSecret();
    const user = await mkUser({ email: "step@club.in", password: "GoodPass1!", role: "COACH" });
    await prisma.user.update({ where: { id: user.id }, data: { twoFactor: true, totpSecret: secret } });
    await post(login, "/api/auth/login", {
      email: "step@club.in", password: "GoodPass1!", totpCode: generateTotp(secret),
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.totpLastStep).not.toBeNull();
  });
});

// ── B5 ───────────────────────────────────────────────────────────────────────

describe("email verification gate", () => {
  it("refuses a sign-in for an account that never proved its address", async () => {
    const user = await mkUser({ email: "unverified@club.in", password: "GoodPass1!", role: "COACH" });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });

    const r = await post(login, "/api/auth/login", {
      email: "unverified@club.in", password: "GoodPass1!",
    });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "EMAIL_UNVERIFIED" });
    expect(cookieJar.size).toBe(0);
  });

  it("lets a verified account straight through", async () => {
    await mkUser({ email: "verified@club.in", password: "GoodPass1!", role: "COACH" });
    const r = await post(login, "/api/auth/login", {
      email: "verified@club.in", password: "GoodPass1!",
    });
    expect(r.status).toBe(200);
  });
});

// ── B8 ───────────────────────────────────────────────────────────────────────

describe("sign-in audit trail", () => {
  it("records a failed attempt, so the ops dashboard tile isn't always zero", async () => {
    await mkUser({ email: "audited@club.in", password: "GoodPass1!", role: "COACH" });
    await post(login, "/api/auth/login", { email: "audited@club.in", password: "nope" });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.login_failed" } });
    expect(row.after).toContain("bad_password");
  });

  it("records failures for addresses that match no account at all", async () => {
    await post(login, "/api/auth/login", { email: "ghost@club.in", password: "nope" });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.login_failed" } });
    expect(row.after).toContain("unknown_email");
  });

  it("records successful sign-ins", async () => {
    await mkUser({ email: "success@club.in", password: "GoodPass1!", role: "COACH" });
    await post(login, "/api/auth/login", { email: "success@club.in", password: "GoodPass1!" });
    expect(await prisma.auditLog.count({ where: { action: "auth.login_succeeded" } })).toBe(1);
  });
});
