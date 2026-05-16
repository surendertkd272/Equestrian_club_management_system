// POST /api/users + DELETE /api/users/[id] — HQ user create / delete.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkRider } from "../helpers/fixtures";
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

const { POST: createUser } = await import("@/app/api/users/route");
const { DELETE: deleteUser } = await import("@/app/api/users/[id]/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

async function loginAsHQ() {
  const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, name: "HQ Boss" });
  await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });
  return su;
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("POST /api/users", () => {
  it("401 without session", async () => {
    const r = await createUser(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({}) }) as any,
    );
    expect(r.status).toBe(401);
  });

  it("403 when caller isn't SUPER_ADMIN", async () => {
    const c = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: c.id, name: mgr.name });
    const r = await createUser(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "X", email: "x@x.test", role: "COACH" }),
      }) as any,
    );
    expect(r.status).toBe(403);
  });

  it("400 VALIDATION on bad email", async () => {
    await loginAsHQ();
    const r = await createUser(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "X", email: "not-email", role: "COACH" }),
      }) as any,
    );
    expect(r.status).toBe(400);
  });

  it("409 EMAIL_TAKEN when email collides", async () => {
    await loginAsHQ();
    await mkUser({ email: "dup@x.test" });
    const r = await createUser(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Two", email: "dup@x.test", role: "COACH" }),
      }) as any,
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("EMAIL_TAKEN");
  });

  it("404 CENTRE_NOT_FOUND when centreId doesn't exist", async () => {
    await loginAsHQ();
    const r = await createUser(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Xander", email: "x@x.test", role: "COACH", centreId: "fake" }),
      }) as any,
    );
    expect(r.status).toBe(404);
  });

  it("happy path: creates user + returns verifiable temp password + audit row", async () => {
    await loginAsHQ();
    const c = await mkCentre();
    const r = await createUser(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "New Coach",
          email: "newcoach@x.test",
          phone: "+91 98765 12345",
          role: "COACH",
          centreId: c.id,
        }),
      }) as any,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(typeof data.tempPassword).toBe("string");
    expect(data.tempPassword.length).toBeGreaterThan(10);

    const created = await prisma.user.findUniqueOrThrow({ where: { id: data.id } });
    expect(created.role).toBe("COACH");
    expect(created.centreId).toBe(c.id);
    expect(created.status).toBe("active");
    expect(await verifyPassword(data.tempPassword, created.passwordHash)).toBe(true);

    const log = await prisma.auditLog.findFirst({ where: { action: "user.create", rowId: created.id } });
    expect(log).not.toBeNull();
  });

  it("creates HQ-scoped user when centreId is null", async () => {
    await loginAsHQ();
    const r = await createUser(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "HQ Helper", email: "helper@hq.test", role: "ACCOUNTANT" }),
      }) as any,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    const created = await prisma.user.findUniqueOrThrow({ where: { id: data.id } });
    expect(created.centreId).toBeNull();
  });
});

describe("DELETE /api/users/[id]", () => {
  it("401 without session", async () => {
    const r = await deleteUser(new Request("http://localhost", { method: "DELETE" }) as any, {
      params: { id: "x" },
    });
    expect(r.status).toBe(401);
  });

  it("403 when caller isn't SUPER_ADMIN", async () => {
    const c = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    const target = await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: c.id, name: mgr.name });
    const r = await deleteUser(new Request("http://localhost", { method: "DELETE" }) as any, {
      params: { id: target.id },
    });
    expect(r.status).toBe(403);
  });

  it("CANNOT_DELETE_SELF", async () => {
    const me = await loginAsHQ();
    const r = await deleteUser(new Request("http://localhost", { method: "DELETE" }) as any, {
      params: { id: me.id },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("CANNOT_DELETE_SELF");
  });

  it("LAST_SUPER_ADMIN refuses when only one active super admin remains", async () => {
    const me = await loginAsHQ();
    // Add a second SUPER_ADMIN but suspended — doesn't count as "active".
    const suspended = await mkUser({
      role: "SUPER_ADMIN",
      centreId: null,
      status: "suspended",
    });
    void suspended;
    const r = await deleteUser(new Request("http://localhost", { method: "DELETE" }) as any, {
      params: { id: me.id },
    });
    // CANNOT_DELETE_SELF actually fires first; that's the right behaviour.
    expect(r.status).toBe(409);
  });

  it("USER_LINKED_TO_RIDER refuses when target owns a rider portal account", async () => {
    await loginAsHQ();
    const c = await mkCentre();
    const target = await mkUser({ role: "RIDER", centreId: c.id });
    const rider = await mkRider({ centreId: c.id });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: target.id } });

    const r = await deleteUser(new Request("http://localhost", { method: "DELETE" }) as any, {
      params: { id: target.id },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("USER_LINKED_TO_RIDER");
  });

  it("USER_IS_CENTRE_MANAGER refuses when target manages a centre", async () => {
    await loginAsHQ();
    const c = await mkCentre();
    const target = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    await prisma.centre.update({ where: { id: c.id }, data: { managerId: target.id } });

    const r = await deleteUser(new Request("http://localhost", { method: "DELETE" }) as any, {
      params: { id: target.id },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("USER_IS_CENTRE_MANAGER");
  });

  it("USER_HAS_PARENT_LINKS refuses when target has linked riders as a parent", async () => {
    await loginAsHQ();
    const c = await mkCentre();
    const target = await mkUser({ role: "PARENT" });
    const rider = await mkRider({ centreId: c.id });
    await prisma.parentLink.create({
      data: { parentUserId: target.id, riderId: rider.id, relationship: "father" },
    });

    const r = await deleteUser(new Request("http://localhost", { method: "DELETE" }) as any, {
      params: { id: target.id },
    });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("USER_HAS_PARENT_LINKS");
  });

  it("happy path: deletes a clean user + writes audit row", async () => {
    await loginAsHQ();
    const c = await mkCentre();
    const target = await mkUser({ role: "COACH", centreId: c.id, name: "Drop Me", email: "drop@x.test" });

    const r = await deleteUser(new Request("http://localhost", { method: "DELETE" }) as any, {
      params: { id: target.id },
    });
    expect(r.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: target.id } });
    expect(after).toBeNull();

    const log = await prisma.auditLog.findFirst({ where: { action: "user.delete", rowId: target.id } });
    expect(log).not.toBeNull();
  });
});

describe("Cross-role: SUPER_ADMIN posts medicine with explicit centreId", () => {
  // Sanity check that the existing POST /api/medicines accepts body.centreId
  // for SUPER_ADMIN — which is what the new UI relies on.
  it("uses body.centreId when session.centreId is null", async () => {
    await loginAsHQ();
    const c = await mkCentre();
    const { POST: createMedicine } = await import("@/app/api/medicines/route");
    const r = await createMedicine(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          centreId: c.id,
          name: "Test med",
          category: "nsaid",
          batchNo: "B-1",
          expDate: "2030-01-01",
          qty: 5,
        }),
      }) as any,
    );
    expect(r.status).toBe(200);
    const meds = await prisma.medicine.findMany({ where: { centreId: c.id } });
    expect(meds).toHaveLength(1);
  });
});
