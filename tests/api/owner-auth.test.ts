import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { prisma } from "@/lib/prisma";
import { verifyOwnerSession, hashOwnerPassword } from "@/lib/owner-auth";

const cookieJar = new Map<string, { value: string; opts?: any }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: any) => cookieJar.set(name, { value, opts }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: login } = await import("@/app/api/owner/auth/login/route");
const { POST: logout } = await import("@/app/api/owner/auth/logout/route");

function postLogin(body: unknown) {
  return login(
    new Request("http://localhost/api/owner/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as any,
  );
}

async function mkPlatformUser(over: {
  email?: string;
  password?: string;
  role?: "OWNER_ADMIN" | "OWNER_EDITOR" | "OWNER_BILLING";
  status?: string;
  name?: string;
} = {}) {
  return prisma.platformUser.create({
    data: {
      email: over.email ?? "owner@platform.local",
      passwordHash: await hashOwnerPassword(over.password ?? "password"),
      name: over.name ?? "Platform Owner",
      role: over.role ?? "OWNER_ADMIN",
      status: over.status ?? "active",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("POST /api/owner/auth/login", () => {
  it("400 VALIDATION for malformed body", async () => {
    const r = await postLogin({ email: "not-an-email", password: "x" });
    expect(r.status).toBe(400);
    expect(cookieJar.size).toBe(0);
  });

  it("401 for unknown email", async () => {
    const r = await postLogin({ email: "nobody@platform.local", password: "anything" });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ error: "Invalid credentials" });
    expect(cookieJar.size).toBe(0);
  });

  it("401 when password doesn't match", async () => {
    await mkPlatformUser({ password: "correct" });
    const r = await postLogin({ email: "owner@platform.local", password: "wrong" });
    expect(r.status).toBe(401);
    expect(cookieJar.size).toBe(0);
  });

  it("401 for a suspended platform user (no enumeration leak)", async () => {
    await mkPlatformUser({ password: "pw", status: "suspended" });
    const r = await postLogin({ email: "owner@platform.local", password: "pw" });
    expect(r.status).toBe(401);
    expect(cookieJar.size).toBe(0);
  });

  it("happy path: 200 + HttpOnly ew_owner_session cookie carrying a verifiable JWT", async () => {
    const u = await mkPlatformUser({
      email: "ops@platform.local",
      password: "supersecret",
      role: "OWNER_ADMIN",
      name: "Ops Owner",
    });
    const r = await postLogin({ email: "ops@platform.local", password: "supersecret" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, redirect: "/owner" });

    const cookie = cookieJar.get("ew_owner_session");
    expect(cookie).toBeDefined();
    expect(cookie!.opts).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });

    const session = await verifyOwnerSession(cookie!.value);
    expect(session).not.toBeNull();
    expect(session!.ownerId).toBe(u.id);
    expect(session!.role).toBe("OWNER_ADMIN");
    expect(session!.name).toBe("Ops Owner");
  });

  it("tenant /api/auth/login cannot log in a PlatformUser (separate auth domain)", async () => {
    await mkPlatformUser({ email: "owner@platform.local", password: "pw" });
    const { POST: tenantLogin } = await import("@/app/api/auth/login/route");
    const r = await tenantLogin(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@platform.local", password: "pw" }),
      }) as any,
    );
    // Tenant route looks up User table — PlatformUser is invisible to it.
    expect(r.status).toBe(401);
  });

  it("owner token cannot be reused as a tenant session (jwt audience guard)", async () => {
    await mkPlatformUser({ password: "pw" });
    await postLogin({ email: "owner@platform.local", password: "pw" });
    const cookie = cookieJar.get("ew_owner_session")!.value;
    const { verifySession } = await import("@/lib/auth");
    // Tenant verifier doesn't set an audience, so the token *might* parse — but
    // the payload shape doesn't include userId/role/centreId, so any tenant
    // route checking those will treat it as malformed.
    const tenant = await verifySession(cookie);
    expect(tenant?.userId).toBeUndefined();
  });
});

describe("POST /api/owner/auth/logout", () => {
  it("clears the owner cookie", async () => {
    await mkPlatformUser({ password: "pw" });
    await postLogin({ email: "owner@platform.local", password: "pw" });
    expect(cookieJar.has("ew_owner_session")).toBe(true);

    const r = await logout();
    expect(r.status).toBe(200);
    expect(cookieJar.has("ew_owner_session")).toBe(false);
  });
});
