import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser } from "../helpers/fixtures";
import { verifySession } from "@/lib/auth";
import { mockReq } from "../helpers/request";

// In-memory cookie jar that stands in for next/headers' cookies() helper. Captures
// .set() calls so we can verify the session cookie shape on success and inspect the
// signed JWT it carries.
const cookieJar = new Map<string, { value: string; opts?: any }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: any) => cookieJar.set(name, { value, opts }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

// Late import so the next/headers mock is registered before lib/auth pulls it in.
const { POST } = await import("@/app/api/auth/login/route");

function postLogin(body: unknown) {
  return POST(
    mockReq("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("POST /api/auth/login", () => {
  it("returns 400 VALIDATION for malformed body", async () => {
    const r = await postLogin({ email: "not-an-email", password: "x" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "VALIDATION" });
    expect(cookieJar.size).toBe(0);
  });

  it("returns 400 VALIDATION when password is missing", async () => {
    const r = await postLogin({ email: "user@test.local" });
    expect(r.status).toBe(400);
  });

  it("returns 400 VALIDATION when the body isn't JSON", async () => {
    const r = await POST(
      mockReq("http://localhost/api/auth/login", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(r.status).toBe(400);
  });

  it("returns 401 for an unknown email (does not leak existence)", async () => {
    const r = await postLogin({ email: "nobody@test.local", password: "anything" });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ error: "Invalid credentials" });
    expect(cookieJar.size).toBe(0);
  });

  it("returns 401 when the password doesn't match", async () => {
    await mkUser({ email: "user@test.local", password: "correct-horse-battery-staple" });
    const r = await postLogin({ email: "user@test.local", password: "wrong-password" });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ error: "Invalid credentials" });
    expect(cookieJar.size).toBe(0);
  });

  it("returns 401 for a suspended user (same response as unknown — no enumeration)", async () => {
    await mkUser({ email: "user@test.local", password: "pw", status: "suspended" });
    const r = await postLogin({ email: "user@test.local", password: "pw" });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ error: "Invalid credentials" });
    expect(cookieJar.size).toBe(0);
  });

  it("returns 500 when the user has a non-Role value stored", async () => {
    await mkUser({ email: "user@test.local", password: "pw", role: "MARTIAN" });
    const r = await postLogin({ email: "user@test.local", password: "pw" });
    expect(r.status).toBe(500);
  });

  it("happy path: 200 + sets an HttpOnly session cookie carrying a verifiable JWT", async () => {
    const user = await mkUser({
      email: "manager@test.local",
      password: "supersecret",
      role: "CENTRE_MANAGER",
      name: "M. Manager",
    });

    const r = await postLogin({ email: "manager@test.local", password: "supersecret" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, redirect: "/dashboard" });

    const cookie = cookieJar.get("ew_session");
    expect(cookie).toBeDefined();
    expect(cookie!.opts).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });

    const session = await verifySession(cookie!.value);
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(user.id);
    expect(session!.role).toBe("CENTRE_MANAGER");
    expect(session!.name).toBe("M. Manager");
    expect(session!.centreId).toBeNull();
  });

  it("PARENT login returns redirect=/parent so the form bounces them off /dashboard", async () => {
    await mkUser({
      email: "parent@test.local",
      password: "pw",
      role: "PARENT",
      name: "Parent P.",
    });
    const r = await postLogin({ email: "parent@test.local", password: "pw" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, redirect: "/parent" });
  });

  it("RIDER login returns redirect=/student", async () => {
    await mkUser({
      email: "rider@test.local",
      password: "pw",
      role: "RIDER",
      name: "Rider R.",
    });
    const r = await postLogin({ email: "rider@test.local", password: "pw" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, redirect: "/student" });
  });

  it("happy path includes centreId in the session when the user is scoped", async () => {
    const { mkCentre } = await import("../helpers/fixtures");
    const centre = await mkCentre();
    const user = await mkUser({
      email: "coach@test.local",
      password: "pw",
      role: "COACH",
      centreId: centre.id,
    });

    const r = await postLogin({ email: "coach@test.local", password: "pw" });
    expect(r.status).toBe(200);

    const session = await verifySession(cookieJar.get("ew_session")!.value);
    expect(session?.userId).toBe(user.id);
    expect(session?.centreId).toBe(centre.id);
  });

  it("returns 403 ACCOUNT_SUSPENDED when the user's org is suspended", async () => {
    const { mkCentre } = await import("../helpers/fixtures");
    const { prisma } = await import("@/lib/prisma");
    const centre = await mkCentre();
    // Flip the org to suspended after creation — helper defaults to active.
    await prisma.organisation.update({
      where: { id: centre.orgId },
      data: { status: "suspended" },
    });
    await mkUser({
      email: "manager@suspended.local",
      password: "pw",
      role: "CENTRE_MANAGER",
      centreId: centre.id,
    });

    const r = await postLogin({ email: "manager@suspended.local", password: "pw" });
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe("ACCOUNT_SUSPENDED");
    expect(body.message).toContain("suspended");
    expect(cookieJar.size).toBe(0);
  });
});
