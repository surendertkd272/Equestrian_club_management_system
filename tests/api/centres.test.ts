import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkUser, mkCentre } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
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

const { PATCH, DELETE } = await import("@/app/api/centres/[id]/route");
const { POST } = await import("@/app/api/centres/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function patch(id: string, body: unknown) {
  return PATCH(
    mockReq(`http://localhost/api/centres/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: { id } },
  );
}

function post(body: unknown) {
  return POST(
    mockReq("http://localhost/api/centres", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

function del(id: string) {
  return DELETE(
    mockReq(`http://localhost/api/centres/${id}`, { method: "DELETE" }),
    { params: { id } },
  );
}

// POST and DELETE both depend on an existing Organisation row. seed the
// "Equiwings" org once per test that needs it — resetDb wipes it between tests.
async function seedOrg() {
  return prisma.organisation.create({ data: { id: "org_equiwings", name: "Equiwings", slug: "equiwings" } });
}

beforeEach(async () => {
  await resetDb();
});

describe("PATCH /api/centres/[id]", () => {
  it("super admin can rename a club and update its address", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre({ name: "Old Name" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(c.id, { name: "Equiwings Pune", address: "Koregaon Park, Pune" });
    expect(r.status).toBe(200);

    const updated = await prisma.centre.findUniqueOrThrow({ where: { id: c.id } });
    expect(updated.name).toBe("Equiwings Pune");
    expect(updated.address).toBe("Koregaon Park, Pune");
    // Slug is intentionally untouched.
    expect(updated.slug).toBe(c.slug);
  });

  it("allows clearing address by sending null", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre({ name: "X" });
    // Seed an address first so we can verify it gets cleared.
    await prisma.centre.update({ where: { id: c.id }, data: { address: "Old Address" } });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(c.id, { address: null });
    expect(r.status).toBe(200);
    const updated = await prisma.centre.findUniqueOrThrow({ where: { id: c.id } });
    expect(updated.address).toBeNull();
  });

  it("partial updates only touch fields explicitly sent", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre({ name: "Original" });
    await prisma.centre.update({
      where: { id: c.id },
      data: { address: "Original Address", gstNo: "07AABCS1429B1Z1" },
    });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(c.id, { name: "Renamed Only" });
    expect(r.status).toBe(200);
    const updated = await prisma.centre.findUniqueOrThrow({ where: { id: c.id } });
    expect(updated.name).toBe("Renamed Only");
    // Other fields preserved.
    expect(updated.address).toBe("Original Address");
    expect(updated.gstNo).toBe("07AABCS1429B1Z1");
  });

  it("rejects malformed GST numbers (length / charset)", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre({ name: "X" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(c.id, { gstNo: "not-a-gst" });
    expect(r.status).toBe(400);
    const fresh = await prisma.centre.findUniqueOrThrow({ where: { id: c.id } });
    expect(fresh.gstNo).toBeNull();
  });

  it("accepts a valid 15-char GST number", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre({ name: "X" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await patch(c.id, { gstNo: "07AABCS1429B1Z1" });
    expect(r.status).toBe(200);
    const fresh = await prisma.centre.findUniqueOrThrow({ where: { id: c.id } });
    expect(fresh.gstNo).toBe("07AABCS1429B1Z1");
  });

  it("returns 403 when a centre manager (non-HQ) tries to rename their own club", async () => {
    const c = await mkCentre({ name: "Club X" });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: c.id, name: mgr.name });

    const r = await patch(c.id, { name: "Renamed by manager" });
    expect(r.status).toBe(403);
    const fresh = await prisma.centre.findUniqueOrThrow({ where: { id: c.id } });
    expect(fresh.name).toBe("Club X");
  });

  it("returns 401 when unauthenticated", async () => {
    const c = await mkCentre({ name: "Y" });
    cookieJar.clear();
    const r = await patch(c.id, { name: "Y2" });
    expect(r.status).toBe(401);
  });

  it("returns 404 for an unknown centre id", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });
    // Name must pass min(2) validation so the request actually reaches the lookup.
    const r = await patch("does-not-exist", { name: "Anything" });
    expect(r.status).toBe(404);
  });

  it("writes an audit row with before/after on rename", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre({ name: "Before Name" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    await patch(c.id, { name: "After Name", address: "After Address" });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: "centre.update", rowId: c.id },
    });
    expect(log.before).toContain("Before Name");
    expect(log.after).toContain("After Name");
    expect(log.userId).toBe(su.id);
  });
});

describe("POST /api/centres (create)", () => {
  it("super admin can create a new club + auto-bootstrap catalog", async () => {
    await seedOrg();
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await post({
      name: "Equiwings Pune",
      slug: "pune",
      address: "Koregaon Park, Pune",
    });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.id).toBeTruthy();
    expect(data.slug).toBe("pune");

    const centre = await prisma.centre.findUniqueOrThrow({ where: { id: data.id } });
    expect(centre.name).toBe("Equiwings Pune");
    expect(centre.address).toBe("Koregaon Park, Pune");

    // Catalog bootstrapped — fee plans, progress levels, scoring templates all present.
    expect(await prisma.feePlan.count({ where: { centreId: centre.id } })).toBeGreaterThanOrEqual(2);
    expect(await prisma.progressLevel.count({ where: { centreId: centre.id } })).toBe(3);
    expect(await prisma.scoringTemplate.count({ where: { centreId: centre.id } })).toBe(2);
    // Skills attached to levels — at least the normal track is seeded.
    const levels = await prisma.progressLevel.findMany({
      where: { centreId: centre.id },
      include: { skills: true },
    });
    const totalSkills = levels.reduce((acc, l) => acc + l.skills.length, 0);
    expect(totalSkills).toBeGreaterThan(0);
  });

  it("rejects duplicate slug with 409 SLUG_TAKEN", async () => {
    await seedOrg();
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    await mkCentre({ slug: "duplicate-slug" });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await post({ name: "Another Club", slug: "duplicate-slug" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("SLUG_TAKEN");
  });

  it("rejects malformed slug (uppercase / starts with digit / too short)", async () => {
    await seedOrg();
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    for (const bad of ["UPPERCASE", "9starts-with-digit", "a", "has spaces"]) {
      const r = await post({ name: "Test", slug: bad });
      expect(r.status, `slug=${bad}`).toBe(400);
    }
  });

  it("returns 403 for non-HQ users (centre manager)", async () => {
    await seedOrg();
    const mgr = await mkUser({ role: "CENTRE_MANAGER" });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: null, name: mgr.name });

    const r = await post({ name: "Sneaky", slug: "sneaky" });
    expect(r.status).toBe(403);
    expect(await prisma.centre.count({ where: { slug: "sneaky" } })).toBe(0);
  });

  it("writes a centre.create audit row", async () => {
    await seedOrg();
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await post({ name: "Equiwings Hyderabad", slug: "hyderabad" });
    expect(r.status).toBe(200);
    const data = await r.json();
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: "centre.create", rowId: data.id },
    });
    expect(log.userId).toBe(su.id);
    expect(log.after).toContain("hyderabad");
  });
});

describe("DELETE /api/centres/[id]", () => {
  it("deletes an empty centre + clears its catalog data", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre({ slug: "to-delete" });
    // Seed some catalog data so we can verify it's cleared.
    await prisma.feePlan.create({
      data: { centreId: c.id, levelName: "Beginner", monthlyAmount: 8000, registrationAmount: 3000 },
    });
    const level = await prisma.progressLevel.create({
      data: { centreId: c.id, name: "Beginner", order: 1 },
    });
    await prisma.skill.create({ data: { levelId: level.id, discipline: "normal", name: "Test skill" } });
    await prisma.scoringTemplate.create({
      data: { centreId: c.id, levelKey: "1", levelName: "Level 1", passThreshold: 60, categoriesJson: "[]" },
    });

    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });
    const r = await del(c.id);
    expect(r.status).toBe(200);

    expect(await prisma.centre.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await prisma.feePlan.count({ where: { centreId: c.id } })).toBe(0);
    expect(await prisma.progressLevel.count({ where: { centreId: c.id } })).toBe(0);
    expect(await prisma.scoringTemplate.count({ where: { centreId: c.id } })).toBe(0);
    // Skill cascade-deletes with the level.
    expect(await prisma.skill.count()).toBe(0);
  });

  it("refuses to delete a centre that still has staff users (409 NOT_EMPTY)", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    const c = await mkCentre({ slug: "has-users" });
    await mkUser({ role: "COACH", centreId: c.id });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });

    const r = await del(c.id);
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toBe("NOT_EMPTY");
    expect(body.counts.users).toBe(1);
    expect(await prisma.centre.findUnique({ where: { id: c.id } })).not.toBeNull();
  });

  it("returns 403 when a centre manager tries to delete their own club", async () => {
    const c = await mkCentre({ slug: "self-delete" });
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: c.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: c.id, name: mgr.name });

    const r = await del(c.id);
    expect(r.status).toBe(403);
    expect(await prisma.centre.findUnique({ where: { id: c.id } })).not.toBeNull();
  });

  it("returns 404 for an unknown centre id", async () => {
    const su = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    await loginAs({ userId: su.id, role: "SUPER_ADMIN", centreId: null, name: su.name });
    const r = await del("ghost");
    expect(r.status).toBe(404);
  });
});
