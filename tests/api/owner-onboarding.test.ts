import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import {
  hashOwnerPassword,
  signOwnerSession,
  type OwnerSessionPayload,
} from "@/lib/owner-auth";
import { verifyPassword } from "@/lib/auth";
import { PLAN_REGISTRY } from "@/lib/plans";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: createTenant } = await import("@/app/api/owner/tenants/route");

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

function validPayload(overrides: Partial<any> = {}) {
  return {
    name: "Royal Riders",
    slug: "royal-riders",
    plan: "pro",
    contactName: "Jane Doe",
    billingEmail: "billing@royal.test",
    phone: "+919999999999",
    centre: {
      name: "Royal HQ",
      slug: "royal-hq",
      address: "1 Riding Lane",
    },
    superAdmin: {
      name: "Admin Person",
      email: "admin@royal.test",
      phone: "+919888888888",
    },
    ...overrides,
  };
}

function postCreate(body: unknown) {
  return createTenant(
    new Request("http://localhost/api/owner/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as any,
  );
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("POST /api/owner/tenants (onboarding)", () => {
  it("401 without owner session", async () => {
    const r = await postCreate(validPayload());
    expect(r.status).toBe(401);
  });

  it("400 VALIDATION on bad slug", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });

    const r = await postCreate(validPayload({ slug: "Royal Riders!" }));
    expect(r.status).toBe(400);
  });

  it("400 VALIDATION on bad super admin email", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });

    const r = await postCreate(
      validPayload({ superAdmin: { name: "X", email: "not-an-email" } }),
    );
    expect(r.status).toBe(400);
  });

  it("409 ORG_SLUG_TAKEN when tenant slug is in use", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    await prisma.organisation.create({
      data: { name: "Existing", slug: "royal-riders" },
    });

    const r = await postCreate(validPayload());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("ORG_SLUG_TAKEN");
  });

  it("409 CENTRE_SLUG_TAKEN when centre slug is globally in use", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();
    await mkCentre({ orgId: org.id, slug: "royal-hq", name: "Some Centre" });

    const r = await postCreate(validPayload());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("CENTRE_SLUG_TAKEN");
  });

  it("409 EMAIL_TAKEN when the super admin email already exists", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    await mkUser({ email: "admin@royal.test" });

    const r = await postCreate(validPayload());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("EMAIL_TAKEN");
  });

  it("happy path: creates org + Pro feature set + centre + SUPER_ADMIN + temp password", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });

    const r = await postCreate(validPayload());
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(typeof data.tempPassword).toBe("string");
    expect(data.tempPassword.length).toBeGreaterThan(10);
    expect(data.superAdminEmail).toBe("admin@royal.test");

    // Org row written with the right plan + contact info
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: data.orgId } });
    expect(org.slug).toBe("royal-riders");
    expect(org.plan).toBe("pro");
    expect(org.status).toBe("active");
    expect(org.contactName).toBe("Jane Doe");
    expect(org.billingEmail).toBe("billing@royal.test");

    // Pro features enabled, advanced features off
    const features = await prisma.orgFeature.findMany({ where: { orgId: org.id } });
    expect(features.length).toBeGreaterThan(0);
    const enabledKeys = new Set(features.filter((f) => f.enabled).map((f) => f.featureKey));
    for (const k of PLAN_REGISTRY.pro.features) {
      expect(enabledKeys.has(k)).toBe(true);
    }
    expect(enabledKeys.has("competitions")).toBe(false);
    expect(enabledKeys.has("external-exams")).toBe(false);

    // Centre wired to the new org
    const centre = await prisma.centre.findUniqueOrThrow({ where: { id: data.centreId } });
    expect(centre.orgId).toBe(org.id);
    expect(centre.slug).toBe("royal-hq");

    // Super admin user — centreId is null (HQ-of-tenant), password verifies
    const su = await prisma.user.findUniqueOrThrow({ where: { id: data.superAdminId } });
    expect(su.role).toBe("SUPER_ADMIN");
    expect(su.centreId).toBeNull();
    expect(su.email).toBe("admin@royal.test");
    expect(await verifyPassword(data.tempPassword, su.passwordHash)).toBe(true);

    // Catalog bootstrap ran (progress levels seeded)
    const levels = await prisma.progressLevel.count({ where: { centreId: centre.id } });
    expect(levels).toBeGreaterThan(0);

    // Owner audit row written
    const log = await prisma.platformAuditLog.findFirstOrThrow({ where: { orgId: org.id } });
    expect(log.action).toBe("owner.tenant_provisioned");
    expect(log.actorId).toBe(owner.id);
  });

  it("Starter plan seeds only the Starter bundle", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });

    const r = await postCreate(
      validPayload({
        slug: "starter-co",
        plan: "starter",
        centre: { name: "Solo HQ", slug: "starter-co-hq" },
        superAdmin: { name: "Solo Admin", email: "starter@x.test" },
      }),
    );
    expect(r.status).toBe(200);
    const data = await r.json();

    const enabled = await prisma.orgFeature.findMany({
      where: { orgId: data.orgId, enabled: true },
      select: { featureKey: true },
    });
    const enabledKeys = new Set(enabled.map((f) => f.featureKey));
    for (const k of PLAN_REGISTRY.starter.features) {
      expect(enabledKeys.has(k)).toBe(true);
    }
    expect(enabledKeys.has("parent-portal")).toBe(false);
    expect(enabledKeys.has("competitions")).toBe(false);
  });

  it("rejects extra fields (no smuggling stripeCustomerId etc. through onboarding)", async () => {
    const owner = await mkAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });

    // zod schema is *not* strict() here — extra top-level fields silently drop.
    // But the prisma payload uses only the allowed fields, so the row should
    // come out clean either way. Sanity check: stripeCustomerId stays null.
    const r = await postCreate({
      ...validPayload(),
      stripeCustomerId: "cus_attacker",
      status: "suspended",
    });
    expect(r.status).toBe(200);
    const data = await r.json();
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: data.orgId } });
    expect(org.stripeCustomerId).toBeNull();
    expect(org.status).toBe("active");
  });
});
