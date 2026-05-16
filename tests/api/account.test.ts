import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkCentre } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, verifyPassword, type SessionPayload } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { GET: getMe, PATCH: patchMe } = await import("@/app/api/account/me/route");
const { POST: changePwd } = await import("@/app/api/account/change-password/route");

async function login(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("GET /api/account/me", () => {
  it("401 without session", async () => {
    const r = await getMe();
    expect(r.status).toBe(401);
  });
  it("returns the signed-in user's profile", async () => {
    const centre = await mkCentre();
    const u = await mkUser({ role: "COACH", centreId: centre.id, name: "Coach C" });
    await login({ userId: u.id, role: "COACH", centreId: centre.id, name: u.name });

    const r = await getMe();
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.user.name).toBe("Coach C");
    expect(data.user.role).toBe("COACH");
    expect(data.user.centre?.id).toBe(centre.id);
  });
});

describe("PATCH /api/account/me", () => {
  it("updates name + phone, ignores email/role attempts", async () => {
    const u = await mkUser({ name: "Original" });
    await prisma.user.update({ where: { id: u.id }, data: { phone: "111" } });
    await login({ userId: u.id, role: u.role as any, centreId: null, name: u.name });

    const r = await patchMe(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed", phone: "222" }),
      }) as any,
    );
    expect(r.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.name).toBe("Renamed");
    expect(after.phone).toBe("222");
  });
  it("rejects extra fields strictly", async () => {
    const u = await mkUser();
    await login({ userId: u.id, role: u.role as any, centreId: null, name: u.name });

    const r = await patchMe(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ role: "SUPER_ADMIN" }),
      }) as any,
    );
    expect(r.status).toBe(400);
  });
});

describe("POST /api/account/change-password", () => {
  it("401 BAD_CURRENT_PASSWORD when current is wrong", async () => {
    const u = await mkUser({ password: "correct" });
    await login({ userId: u.id, role: u.role as any, centreId: null, name: u.name });

    const r = await changePwd(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ currentPassword: "wrong", newPassword: "newpass123" }),
      }) as any,
    );
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe("BAD_CURRENT_PASSWORD");
  });

  it("400 when new password too short", async () => {
    const u = await mkUser({ password: "correct" });
    await login({ userId: u.id, role: u.role as any, centreId: null, name: u.name });

    const r = await changePwd(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ currentPassword: "correct", newPassword: "short" }),
      }) as any,
    );
    expect(r.status).toBe(400);
  });

  it("happy path: rotates the hash + the new password verifies", async () => {
    const u = await mkUser({ password: "correct" });
    await login({ userId: u.id, role: u.role as any, centreId: null, name: u.name });

    const r = await changePwd(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ currentPassword: "correct", newPassword: "NewPass123!" }),
      }) as any,
    );
    expect(r.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await verifyPassword("NewPass123!", after.passwordHash)).toBe(true);
    expect(await verifyPassword("correct", after.passwordHash)).toBe(false);
  });
});
