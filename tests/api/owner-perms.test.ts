import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import {
  hashOwnerPassword,
  signOwnerSession,
  type OwnerRole,
  type OwnerSessionPayload,
} from "@/lib/owner-auth";
import { ownerCan } from "@/lib/owner-permissions";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: createTenant } = await import("@/app/api/owner/tenants/route");
const { PATCH: patchTenant } = await import("@/app/api/owner/tenants/[id]/route");
const { POST: changePlan } = await import("@/app/api/owner/tenants/[id]/plan/route");
const { POST: toggleFeature } = await import("@/app/api/owner/tenants/[id]/features/route");

async function loginOwner(payload: OwnerSessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_owner_session", { value: await signOwnerSession(payload) });
}

async function mkPlatformUser(role: OwnerRole = "OWNER_ADMIN") {
  return prisma.platformUser.create({
    data: {
      email: `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@platform.local`,
      passwordHash: await hashOwnerPassword("password"),
      name: role,
      role,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("ownerCan matrix", () => {
  it("OWNER_ADMIN has every permission", () => {
    expect(ownerCan("OWNER_ADMIN", "tenant.read")).toBe(true);
    expect(ownerCan("OWNER_ADMIN", "tenant.edit_metadata")).toBe(true);
    expect(ownerCan("OWNER_ADMIN", "tenant.edit_billing")).toBe(true);
    expect(ownerCan("OWNER_ADMIN", "tenant.change_status")).toBe(true);
    expect(ownerCan("OWNER_ADMIN", "tenant.change_plan")).toBe(true);
    expect(ownerCan("OWNER_ADMIN", "tenant.toggle_features")).toBe(true);
    expect(ownerCan("OWNER_ADMIN", "tenant.create")).toBe(true);
    expect(ownerCan("OWNER_ADMIN", "team.manage")).toBe(true);
  });
  it("OWNER_EDITOR can read + edit metadata only", () => {
    expect(ownerCan("OWNER_EDITOR", "tenant.read")).toBe(true);
    expect(ownerCan("OWNER_EDITOR", "tenant.edit_metadata")).toBe(true);
    expect(ownerCan("OWNER_EDITOR", "tenant.edit_billing")).toBe(false);
    expect(ownerCan("OWNER_EDITOR", "tenant.change_status")).toBe(false);
    expect(ownerCan("OWNER_EDITOR", "tenant.change_plan")).toBe(false);
    expect(ownerCan("OWNER_EDITOR", "team.manage")).toBe(false);
  });
  it("OWNER_BILLING can edit billing + status only", () => {
    expect(ownerCan("OWNER_BILLING", "tenant.read")).toBe(true);
    expect(ownerCan("OWNER_BILLING", "tenant.edit_billing")).toBe(true);
    expect(ownerCan("OWNER_BILLING", "tenant.change_status")).toBe(true);
    expect(ownerCan("OWNER_BILLING", "tenant.edit_metadata")).toBe(false);
    expect(ownerCan("OWNER_BILLING", "tenant.change_plan")).toBe(false);
    expect(ownerCan("OWNER_BILLING", "team.manage")).toBe(false);
  });
});

describe("POST /api/owner/tenants — only ADMIN can onboard", () => {
  const payload = {
    name: "Test Co",
    slug: "test-co",
    plan: "starter",
    centre: { name: "HQ", slug: "test-co-hq" },
    superAdmin: { name: "Admin", email: "a@test.co" },
  };

  it("403 for OWNER_EDITOR", async () => {
    const u = await mkPlatformUser("OWNER_EDITOR");
    await loginOwner({ ownerId: u.id, role: "OWNER_EDITOR", name: u.name });
    const r = await createTenant(
      new Request("http://localhost", { method: "POST", body: JSON.stringify(payload) }) as any,
    );
    expect(r.status).toBe(403);
    expect((await r.json()).required).toBe("tenant.create");
  });

  it("403 for OWNER_BILLING", async () => {
    const u = await mkPlatformUser("OWNER_BILLING");
    await loginOwner({ ownerId: u.id, role: "OWNER_BILLING", name: u.name });
    const r = await createTenant(
      new Request("http://localhost", { method: "POST", body: JSON.stringify(payload) }) as any,
    );
    expect(r.status).toBe(403);
  });

  it("200 for OWNER_ADMIN", async () => {
    const u = await mkPlatformUser("OWNER_ADMIN");
    await loginOwner({ ownerId: u.id, role: "OWNER_ADMIN", name: u.name });
    const r = await createTenant(
      new Request("http://localhost", { method: "POST", body: JSON.stringify(payload) }) as any,
    );
    expect(r.status).toBe(200);
  });
});

describe("PATCH /api/owner/tenants/[id] — field-by-field permission", () => {
  it("OWNER_EDITOR can rename but not change status", async () => {
    const u = await mkPlatformUser("OWNER_EDITOR");
    await loginOwner({ ownerId: u.id, role: "OWNER_EDITOR", name: u.name });
    const org = await mkOrg();

    const rename = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed" }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(rename.status).toBe(200);

    const status = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ status: "suspended" }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(status.status).toBe(403);
    expect((await status.json()).required).toBe("tenant.change_status");
  });

  it("OWNER_BILLING can change status but not name", async () => {
    const u = await mkPlatformUser("OWNER_BILLING");
    await loginOwner({ ownerId: u.id, role: "OWNER_BILLING", name: u.name });
    const org = await mkOrg();

    const status = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ status: "past_due" }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(status.status).toBe(200);

    const rename = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "X" }),
      }) as any,
      { params: { id: org.id } },
    );
    // 400 because name "X" is too short — but a longer one should be 403:
    expect(rename.status).toBe(400);

    const rename2 = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed Co" }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(rename2.status).toBe(403);
    expect((await rename2.json()).required).toBe("tenant.edit_metadata");
  });

  it("OWNER_BILLING can edit billingEmail", async () => {
    const u = await mkPlatformUser("OWNER_BILLING");
    await loginOwner({ ownerId: u.id, role: "OWNER_BILLING", name: u.name });
    const org = await mkOrg();

    const r = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ billingEmail: "new@billing.test" }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(200);
  });
});

describe("Plan + feature toggles — admin-only", () => {
  it("403 for OWNER_EDITOR trying to change plan", async () => {
    const u = await mkPlatformUser("OWNER_EDITOR");
    await loginOwner({ ownerId: u.id, role: "OWNER_EDITOR", name: u.name });
    const org = await mkOrg();

    const r = await changePlan(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({ plan: "pro" }) }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(403);
  });

  it("403 for OWNER_BILLING trying to toggle a feature", async () => {
    const u = await mkPlatformUser("OWNER_BILLING");
    await loginOwner({ ownerId: u.id, role: "OWNER_BILLING", name: u.name });
    const org = await mkOrg();
    await prisma.organisation.update({ where: { id: org.id }, data: { plan: "enterprise" } });

    const r = await toggleFeature(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ featureKey: "competitions", enabled: true }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(403);
  });
});
