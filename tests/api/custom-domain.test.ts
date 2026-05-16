import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg } from "../helpers/fixtures";
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

const { PATCH: patchDomain } = await import("@/app/api/owner/tenants/[id]/custom-domain/route");

async function loginOwner(payload: OwnerSessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_owner_session", { value: await signOwnerSession(payload) });
}

async function mkPlatformAdmin() {
  return prisma.platformUser.create({
    data: {
      email: `o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@p.test`,
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

describe("PATCH /api/owner/tenants/[id]/custom-domain", () => {
  it("401 without session", async () => {
    const r = await patchDomain(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ customDomain: "x.com" }) }) as any,
      { params: { id: "y" } },
    );
    expect(r.status).toBe(401);
  });

  it("403 for OWNER_EDITOR (lacks tenant.edit_billing)", async () => {
    const editor = await prisma.platformUser.create({
      data: { email: "e@p.test", passwordHash: await hashOwnerPassword("x"), name: "E", role: "OWNER_EDITOR" },
    });
    await loginOwner({ ownerId: editor.id, role: "OWNER_EDITOR", name: editor.name });
    const org = await mkOrg();

    const r = await patchDomain(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ customDomain: "app.x.com" }) }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(403);
  });

  it("400 VALIDATION on bad hostname", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    const r = await patchDomain(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ customDomain: "not a domain" }) }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(400);
  });

  it("happy path: sets domain, verifiedAt initially null", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    const r = await patchDomain(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ customDomain: "App.Acme.com" }) }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(200);

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.customDomain).toBe("app.acme.com"); // lowercased
    expect(after.customDomainVerifiedAt).toBeNull();
  });

  it("409 DOMAIN_ALREADY_CLAIMED when another tenant has it", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const a = await mkOrg("A");
    const b = await mkOrg("B");
    await prisma.organisation.update({
      where: { id: a.id },
      data: { customDomain: "app.shared.com" },
    });

    const r = await patchDomain(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ customDomain: "app.shared.com" }) }) as any,
      { params: { id: b.id } },
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("DOMAIN_ALREADY_CLAIMED");
  });

  it("verified=true stamps verifiedAt; changing domain resets it", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();

    // Set + verify
    await patchDomain(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ customDomain: "app.acme.com" }) }) as any,
      { params: { id: org.id } },
    );
    await patchDomain(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ customDomain: "app.acme.com", verified: true }) }) as any,
      { params: { id: org.id } },
    );
    let row = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(row.customDomainVerifiedAt).not.toBeNull();

    // Change domain — verification resets.
    await patchDomain(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ customDomain: "app.acme2.com" }) }) as any,
      { params: { id: org.id } },
    );
    row = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(row.customDomain).toBe("app.acme2.com");
    expect(row.customDomainVerifiedAt).toBeNull();
  });

  it("clear domain → null sets both columns to null", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg();
    await prisma.organisation.update({
      where: { id: org.id },
      data: { customDomain: "app.acme.com", customDomainVerifiedAt: new Date() },
    });

    const r = await patchDomain(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ customDomain: null }) }) as any,
      { params: { id: org.id } },
    );
    expect(r.status).toBe(200);

    const after = await prisma.organisation.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.customDomain).toBeNull();
    expect(after.customDomainVerifiedAt).toBeNull();
  });
});
