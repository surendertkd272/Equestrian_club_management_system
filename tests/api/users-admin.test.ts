import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkUser, mkCentre } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, verifyPassword } from "@/lib/auth";
import { mockReq } from "../helpers/request";
import type { SessionPayload } from "@/lib/auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { GET: listUsers } = await import("@/app/api/users/route");
const { PATCH } = await import("@/app/api/users/[id]/route");
const { POST: resetPwd } = await import("@/app/api/users/[id]/reset-password/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function list(qs: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/users");
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return listUsers(mockReq(url));
}

function patch(id: string, body: unknown) {
  return PATCH(
    mockReq(`http://localhost/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: { id } },
  );
}

function reset(id: string) {
  return resetPwd(
    mockReq(`http://localhost/api/users/${id}/reset-password`, { method: "POST" }),
    { params: { id } },
  );
}

beforeEach(async () => {
  await resetDb();
});

describe("GET /api/users", () => {
  it("returns 403 when caller isn't SUPER_ADMIN", async () => {
    const c = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: c.id, name: mgr.name });
    const r = await list();
    expect(r.status).toBe(403);
  });

  it("HQ lists all users with total count", async () => {
    // All four users share one org so the HQ admin (org-scoped post-C1) sees them.
    const org = await mkOrg();
    const c = await mkCentre({ orgId: org.id });
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await mkUser({ role: "COACH", centreId: c.id, name: "Coach A" });
    await mkUser({ role: "VET", centreId: c.id, name: "Vet B" });
    await mkUser({ role: "PARENT", centreId: null, orgId: org.id, name: "Parent C" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await list();
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.total).toBe(4);
    expect(data.rows).toHaveLength(4);
  });

  it("filters by role", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre();
    await mkUser({ role: "COACH", centreId: c.id });
    await mkUser({ role: "COACH", centreId: c.id });
    await mkUser({ role: "VET", centreId: c.id });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await list({ role: "COACH" });
    const data = await r.json();
    expect(data.rows).toHaveLength(2);
    expect(data.rows.every((u: any) => u.role === "COACH")).toBe(true);
  });

  it("filters by centreId='null' to find HQ users", async () => {
    const org = await mkOrg();
    const c = await mkCentre({ orgId: org.id });
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await list({ centreId: "null" });
    const data = await r.json();
    // Only the HQ super admin matches (centre-less, in the caller's org).
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].id).toBe(su.id);
  });

  it("filters by status", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre();
    await mkUser({ role: "COACH", centreId: c.id, status: "suspended" });
    await mkUser({ role: "COACH", centreId: c.id, status: "active" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await list({ status: "suspended" });
    const data = await r.json();
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].status).toBe("suspended");
  });

  it("q searches case-insensitively across name + email", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre();
    await mkUser({ role: "COACH", centreId: c.id, name: "Ravi Kumar", email: "ravi@test.local" });
    await mkUser({ role: "COACH", centreId: c.id, name: "Anita Singh", email: "anita@test.local" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r1 = await list({ q: "ravi" });
    expect((await r1.json()).rows).toHaveLength(1);
    const r2 = await list({ q: "anita@test" });
    expect((await r2.json()).rows).toHaveLength(1);
  });
});

describe("PATCH /api/users/[id]", () => {
  it("HQ can update name, phone, role, centreId, status in one call", async () => {
    // Both centres in ONE organisation, and the admin bound to it. Previously
    // this built an HQ user with no org and two centres in two different orgs —
    // the ambiguous case the centre fence now refuses, because there is no way
    // to tell which organisation such an admin belongs to.
    const org = await mkOrg();
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    const c1 = await mkCentre({ slug: "c1", orgId: org.id });
    const c2 = await mkCentre({ slug: "c2", orgId: org.id });
    const u = await mkUser({ role: "GROOM", centreId: c1.id, name: "Old Name" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(u.id, {
      name: "New Name",
      phone: "9876543210",
      role: "STABLE_MANAGER",
      centreId: c2.id,
    });
    expect(r.status).toBe(200);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(fresh.name).toBe("New Name");
    expect(fresh.phone).toBe("9876543210");
    expect(fresh.role).toBe("STABLE_MANAGER");
    expect(fresh.centreId).toBe(c2.id);
  });

  it("returns 403 for non-SUPER_ADMIN callers", async () => {
    const c = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    const target = await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: c.id, name: mgr.name });
    const r = await patch(target.id, { name: "Hacked" });
    expect(r.status).toBe(403);
  });

  it("LAST_SUPER_ADMIN: refuses to demote the only super admin", async () => {
    const org = await mkOrg();
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });
    const r = await patch(su.id, { role: "COACH" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("LAST_SUPER_ADMIN");
  });

  it("LAST_SUPER_ADMIN: refuses to suspend the only super admin", async () => {
    const org = await mkOrg();
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    const other = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    // Suspend the OTHER one — now su is the last active super admin.
    await prisma.user.update({ where: { id: other.id }, data: { status: "suspended" } });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(su.id, { status: "suspended" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("LAST_SUPER_ADMIN");
  });

  it("with multiple super admins, one can be demoted", async () => {
    const org = await mkOrg();
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    const other = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(other.id, { role: "ACCOUNTANT" });
    expect(r.status).toBe(200);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(fresh.role).toBe("ACCOUNTANT");
  });

  it("CANNOT_DEMOTE_SELF: blocks suspending yourself even with backups", async () => {
    const org = await mkOrg();
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });
    await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id }); // backup admin
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(su.id, { status: "suspended" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("CANNOT_DEMOTE_SELF");
  });

  it("EMAIL_TAKEN: rejects email collision with another user", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre();
    const a = await mkUser({ role: "COACH", centreId: c.id, email: "a@test.local" });
    const b = await mkUser({ role: "COACH", centreId: c.id, email: "b@test.local" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(b.id, { email: "a@test.local" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("EMAIL_TAKEN");
    // a's email unchanged
    const aFresh = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(aFresh.email).toBe("a@test.local");
  });

  it("CENTRE_NOT_FOUND: rejects move to non-existent centre", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre();
    const u = await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(u.id, { centreId: "no-such-centre" });
    expect(r.status).toBe(404);
  });

  it("audit row records before/after of every changed field", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre();
    const u = await mkUser({ role: "COACH", centreId: c.id, name: "Before" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    await patch(u.id, { name: "After", role: "VET" });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: "user.update", rowId: u.id },
    });
    expect(log.before).toContain("Before");
    expect(log.before).toContain("COACH");
    expect(log.after).toContain("After");
    expect(log.after).toContain("VET");
  });
});

describe("POST /api/users/[id]/reset-password", () => {
  it("HQ generates a temp password; the user's old password stops working", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre();
    const u = await mkUser({ role: "PARENT", centreId: c.id, password: "original-pw" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await reset(u.id);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(typeof data.tempPassword).toBe("string");
    expect(data.tempPassword.length).toBeGreaterThanOrEqual(12);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await verifyPassword(data.tempPassword, fresh.passwordHash)).toBe(true);
    expect(await verifyPassword("original-pw", fresh.passwordHash)).toBe(false);
  });

  it("403 for non-SUPER_ADMIN", async () => {
    const c = await mkCentre();
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    const u = await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: c.id, name: mgr.name });

    const r = await reset(u.id);
    expect(r.status).toBe(403);
  });

  it("404 for unknown user", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });
    const r = await reset("ghost");
    expect(r.status).toBe(404);
  });

  it("writes a user.reset_password audit row", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre();
    const u = await mkUser({ role: "PARENT", centreId: c.id });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    await reset(u.id);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: "user.reset_password", rowId: u.id },
    });
    expect(log.userId).toBe(su.id);
  });
});
