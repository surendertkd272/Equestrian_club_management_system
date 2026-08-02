import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mockReq } from "../helpers/request";
import { mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: rawRequestDelete } = await import("@/app/api/account/delete/route");

// Requesting erasure now re-proves the password (step-up auth), so the helper
// presents it. Pass a different one to exercise the rejection path.
function requestDelete(currentPassword = "pw") {
  return rawRequestDelete(
    mockReq("http://localhost/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword }),
    }),
  );
}
const { POST: cancelDelete } = await import("@/app/api/account/delete/cancel/route");

async function login(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("DPDPA right-to-erasure", () => {
  it("schedules deletion + clears session + sets tokenVersion bump", async () => {
    const u = await mkUser({ email: "leaver@test.local", password: "pw" });
    const before = u.tokenVersion;
    await login({ userId: u.id, role: u.role as Role, centreId: null, name: u.name, tokenVersion: before });

    const r = await requestDelete();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.scheduledFor).toBeDefined();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.deletionRequestedAt).not.toBeNull();
    expect(after.tokenVersion).toBe(before + 1);
    expect(cookieJar.has("ew_session")).toBe(false);
  });

  it("refuses a second request while one is pending", async () => {
    const u = await mkUser({ password: "pw" });
    await login({ userId: u.id, role: u.role as Role, centreId: null, name: u.name });
    await requestDelete();

    // Re-login because the first request cleared the cookie.
    await login({ userId: u.id, role: u.role as Role, centreId: null, name: u.name });
    const r2 = await requestDelete();
    // It's UNAUTHENTICATED because getSession() now refuses pending-deletion users.
    expect([401, 409]).toContain(r2.status);
  });

  it("cancels a pending deletion via cookie even when getSession is dead", async () => {
    const u = await mkUser({ password: "pw" });
    // Issue a JWT now, then mark the user pending-deletion server-side.
    await login({ userId: u.id, role: u.role as Role, centreId: null, name: u.name, tokenVersion: u.tokenVersion });
    await prisma.user.update({
      where: { id: u.id },
      data: { deletionRequestedAt: new Date() },
    });

    const r = await cancelDelete();
    expect(r.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.deletionRequestedAt).toBeNull();
  });

  it("getSession() rejects pending-deletion users", async () => {
    const u = await mkUser({ password: "pw" });
    await prisma.user.update({
      where: { id: u.id },
      data: { deletionRequestedAt: new Date(), tokenVersion: 1 },
    });
    await login({ userId: u.id, role: u.role as Role, centreId: null, name: u.name, tokenVersion: 1 });

    const { getSession } = await import("@/lib/auth");
    const session = await getSession();
    expect(session).toBeNull();
  });
});
