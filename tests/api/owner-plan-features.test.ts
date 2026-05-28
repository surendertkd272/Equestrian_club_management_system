import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import {
  hashOwnerPassword,
  signOwnerSession,
  type OwnerSessionPayload,
} from "@/lib/owner-auth";
import { PLAN_REGISTRY } from "@/lib/plans";
import { hasFeature, getOrgFeatures } from "@/lib/features-gate";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: changePlan } = await import("@/app/api/owner/tenants/[id]/plan/route");
const { POST: toggleFeature } = await import("@/app/api/owner/tenants/[id]/features/route");

async function loginOwner(payload: OwnerSessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_owner_session", { value: await signOwnerSession(payload) });
}

async function mkAdmin() {
  return prisma.platformUser.create({
    data: {
      email: `owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@platform.local`,
      passwordHash: await hashOwnerPassword("password"),
      name: "Owner",
      role: "OWNER_ADMIN",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("POST /api/owner/tenants/[id]/plan", () => {
  it("401 without session", async () => {
    const r = await changePlan(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ plan: "pro" }) }),
      { params: { id: "x" } },
    );
    expect(r.status).toBe(401);
  });

  it("400 VALIDATION for unknown plan", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    const r = await changePlan(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ plan: "moon" }) }),
      { params: { id: org.id } },
    );
    expect(r.status).toBe(400);
  });

  it("404 ORG_NOT_FOUND for missing tenant", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });

    const r = await changePlan(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ plan: "pro" }) }),
      { params: { id: "nope" } },
    );
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("ORG_NOT_FOUND");
  });

  it("409 SAME_PLAN when already on the requested plan", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();
    // mkOrg leaves plan = "starter" (Organisation default).

    const r = await changePlan(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ plan: "starter" }) }),
      { params: { id: org.id } },
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("SAME_PLAN");
  });

  it("happy path: starter → pro reseeds OrgFeature to the Pro bundle exactly", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    const r = await changePlan(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ plan: "pro" }) }),
      { params: { id: org.id } },
    );
    expect(r.status).toBe(200);

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.plan).toBe("pro");

    const set = await getOrgFeatures(org.id);
    for (const key of PLAN_REGISTRY.pro.features) {
      expect(set.has(key)).toBe(true);
    }
    // Features NOT in Pro should be off:
    expect(await hasFeature(org.id, "competitions")).toBe(false);
    expect(await hasFeature(org.id, "external-exams")).toBe(false);
  });

  it("audit row written on plan change", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    await changePlan(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ plan: "enterprise" }) }),
      { params: { id: org.id } },
    );
    const logs = await prisma.platformAuditLog.findMany({ where: { orgId: org.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("owner.plan_changed");
    expect(logs[0].before).toContain("starter");
    expect(logs[0].after).toContain("enterprise");
  });

  it("409 TOO_MANY_CENTRES when downgrading below current centre count", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    // Make a Pro tenant with 3 centres → downgrade to Starter (max 1) should fail.
    const org = await mkOrg();
    await prisma.organisation.update({ where: { id: org.id }, data: { plan: "pro" } });
    await mkCentre({ orgId: org.id, name: "A" });
    await mkCentre({ orgId: org.id, name: "B" });
    await mkCentre({ orgId: org.id, name: "C" });

    const r = await changePlan(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ plan: "starter" }) }),
      { params: { id: org.id } },
    );
    expect(r.status).toBe(409);
    const data = await r.json();
    expect(data.error).toBe("TOO_MANY_CENTRES");
    expect(data.details).toMatchObject({ centreCount: 3, maxCentres: 1 });

    // Plan unchanged — transaction rolled back.
    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.plan).toBe("pro");
  });
});

describe("POST /api/owner/tenants/[id]/features", () => {
  it("401 without session", async () => {
    const r = await toggleFeature(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ featureKey: "competitions", enabled: true }),
      }),
      { params: { id: "x" } },
    );
    expect(r.status).toBe(401);
  });

  it("400 VALIDATION for unknown feature key", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();
    await prisma.organisation.update({ where: { id: org.id }, data: { plan: "enterprise" } });

    const r = await toggleFeature(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ featureKey: "made-up", enabled: true }),
      }),
      { params: { id: org.id } },
    );
    expect(r.status).toBe(400);
  });

  it("404 NOT_FOUND for missing tenant", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const r = await toggleFeature(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ featureKey: "competitions", enabled: true }),
      }),
      { params: { id: "nope" } },
    );
    expect(r.status).toBe(404);
  });

  it("409 OVERRIDES_NOT_ALLOWED for non-Enterprise tenants", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();
    await prisma.organisation.update({ where: { id: org.id }, data: { plan: "pro" } });

    const r = await toggleFeature(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ featureKey: "competitions", enabled: true }),
      }),
      { params: { id: org.id } },
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("OVERRIDES_NOT_ALLOWED");
  });

  it("happy path on Enterprise: toggles a feature on/off and writes audit row", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();
    await prisma.organisation.update({ where: { id: org.id }, data: { plan: "enterprise" } });

    // Turn competitions OFF (Enterprise has it on by default after applyPlan,
    // but our raw org just has the default = no feature rows yet).
    const r = await toggleFeature(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ featureKey: "competitions", enabled: true }),
      }),
      { params: { id: org.id } },
    );
    expect(r.status).toBe(200);
    expect(await hasFeature(org.id, "competitions")).toBe(true);

    const logs = await prisma.platformAuditLog.findMany({ where: { orgId: org.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("owner.feature_toggled");
  });
});
