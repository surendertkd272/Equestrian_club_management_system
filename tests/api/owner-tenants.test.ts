import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import {
  hashOwnerPassword,
  signOwnerSession,
  type OwnerSessionPayload,
} from "@/lib/owner-auth";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { GET: listTenants } = await import("@/app/api/owner/tenants/route");
const { GET: getTenant, PATCH: patchTenant } = await import("@/app/api/owner/tenants/[id]/route");

async function loginOwner(payload: OwnerSessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_owner_session", { value: await signOwnerSession(payload) });
}

async function mkPlatformAdmin(over: { name?: string; email?: string } = {}) {
  return prisma.platformUser.create({
    data: {
      email: over.email ?? "owner@platform.local",
      passwordHash: await hashOwnerPassword("password"),
      name: over.name ?? "Owner",
      role: "OWNER_ADMIN",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("GET /api/owner/tenants", () => {
  it("401 when no owner session", async () => {
    const r = await listTenants(new Request("http://localhost/api/owner/tenants") as any);
    expect(r.status).toBe(401);
  });

  it("returns tenants with centres + rider counts", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });

    const org = await mkOrg("Equiwings");
    const c1 = await mkCentre({ orgId: org.id, name: "Ghaziabad" });
    const c2 = await mkCentre({ orgId: org.id, name: "Gurgaon" });
    await mkRider({ centreId: c1.id });
    await mkRider({ centreId: c1.id });
    await mkRider({ centreId: c2.id });

    const r = await listTenants(new Request("http://localhost/api/owner/tenants") as any);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.tenants).toHaveLength(1);
    expect(data.tenants[0]).toMatchObject({
      id: org.id,
      name: "Equiwings",
      centresCount: 2,
      ridersCount: 3,
    });
  });

  it("filters by status", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    await mkOrg("Active Co");
    const suspended = await mkOrg("Suspended Co");
    await prisma.organisation.update({ where: { id: suspended.id }, data: { status: "suspended" } });

    const r = await listTenants(new Request("http://localhost/api/owner/tenants?status=suspended") as any);
    const data = await r.json();
    expect(data.tenants).toHaveLength(1);
    expect(data.tenants[0].name).toBe("Suspended Co");
  });

  it("filters by plan", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    await mkOrg("Starter Co");
    const enterprise = await mkOrg("Enterprise Co");
    await prisma.organisation.update({ where: { id: enterprise.id }, data: { plan: "enterprise" } });

    const r = await listTenants(new Request("http://localhost/api/owner/tenants?plan=enterprise") as any);
    const data = await r.json();
    expect(data.tenants).toHaveLength(1);
    expect(data.tenants[0].name).toBe("Enterprise Co");
  });

  it("text search matches name (case-insensitive on simple substring)", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    await mkOrg("Royal Riders");
    await mkOrg("City Stables");

    const r = await listTenants(new Request("http://localhost/api/owner/tenants?q=Royal") as any);
    const data = await r.json();
    expect(data.tenants.map((t: any) => t.name)).toEqual(["Royal Riders"]);
  });
});

describe("GET /api/owner/tenants/[id]", () => {
  it("401 without session", async () => {
    const r = await getTenant(new Request("http://localhost") as any, { params: { id: "x" } });
    expect(r.status).toBe(401);
  });

  it("404 for unknown id", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const r = await getTenant(new Request("http://localhost") as any, { params: { id: "nope" } });
    expect(r.status).toBe(404);
  });

  it("returns full detail including centres + super admin list", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg("Acme");
    const c = await mkCentre({ orgId: org.id, name: "HQ Centre" });
    await prisma.user.create({
      data: {
        email: "super@acme.test",
        passwordHash: "x",
        name: "Acme Super",
        role: "SUPER_ADMIN",
        centreId: c.id,
      },
    });

    const r = await getTenant(new Request("http://localhost") as any, { params: { id: org.id } });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.tenant.name).toBe("Acme");
    expect(data.tenant.centres).toHaveLength(1);
    expect(data.tenant.superAdmins).toHaveLength(1);
    expect(data.tenant.superAdmins[0].email).toBe("super@acme.test");
    expect(data.tenant.stats.centreCount).toBe(1);
  });
});

describe("PATCH /api/owner/tenants/[id]", () => {
  it("401 without session", async () => {
    const r = await patchTenant(new Request("http://localhost", { method: "PATCH" }) as any, {
      params: { id: "x" },
    });
    expect(r.status).toBe(401);
  });

  it("400 VALIDATION on bad email", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    const r = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ billingEmail: "not-an-email" }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(400);
  });

  it("400 NO_CHANGES when body is empty", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    const r = await patchTenant(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({}) }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("NO_CHANGES");
  });

  it("rejects extra fields (strict schema — slug stays immutable)", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    const r = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ slug: "renamed", name: "ok" }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(400);
  });

  it("updates name + contact + billing and writes a PlatformAuditLog row", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg("Original Name");

    const r = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Renamed",
          contactName: "Jane Doe",
          billingEmail: "billing@acme.test",
        }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(200);

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.name).toBe("Renamed");
    expect(after.contactName).toBe("Jane Doe");
    expect(after.billingEmail).toBe("billing@acme.test");

    const logs = await prisma.platformAuditLog.findMany({ where: { orgId: org.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("owner.tenant_updated");
    expect(logs[0].actorId).toBe(owner.id);
  });

  it("status change writes owner.tenant_status_changed action", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    const r = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ status: "suspended" }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(200);

    const log = await prisma.platformAuditLog.findFirstOrThrow({ where: { orgId: org.id } });
    expect(log.action).toBe("owner.tenant_status_changed");
  });

  it("clears nullable fields when empty string is passed", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();
    await prisma.organisation.update({
      where: { id: org.id },
      data: { contactName: "Old", phone: "12345" },
    });

    const r = await patchTenant(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ contactName: "", phone: "" }),
      }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(200);

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.contactName).toBeNull();
    expect(after.phone).toBeNull();
  });
});
