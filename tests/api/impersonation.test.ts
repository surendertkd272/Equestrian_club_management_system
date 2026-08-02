import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import {
  hashOwnerPassword,
  signOwnerSession,
  type OwnerSessionPayload,
} from "@/lib/owner-auth";
import { signSession, verifySession, type SessionPayload } from "@/lib/auth";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: impersonate } = await import("@/app/api/owner/tenants/[id]/impersonate/route");
const { POST: stopImpersonating } = await import("@/app/api/owner/impersonate/stop/route");

async function loginOwner(payload: OwnerSessionPayload) {
  cookieJar.clear();
  // Sessions must carry the row's tokenVersion: getOwnerSession() now rejects a
  // token without one, because such a token opts out of every revocation check.
  // An explicit tokenVersion in `payload` still wins (mismatch tests rely on it).
  const row = await prisma.platformUser.findUnique({
    where: { id: payload.ownerId },
    select: { tokenVersion: true },
  });
  cookieJar.set("ew_owner_session", {
    value: await signOwnerSession({ tokenVersion: row?.tokenVersion ?? 0, ...payload }),
  });
}

async function mkPlatformAdmin() {
  return prisma.platformUser.create({
    data: {
      email: `owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@p.test`,
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

describe("POST /api/owner/tenants/[id]/impersonate", () => {
  it("401 without owner session", async () => {
    const r = await impersonate(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ userId: "x" }) }),
      { params: { id: "y" } },
    );
    expect(r.status).toBe(401);
  });

  it("403 when caller isn't OWNER_ADMIN", async () => {
    const editor = await prisma.platformUser.create({
      data: { email: "e@p.test", passwordHash: await hashOwnerPassword("x"), name: "E", role: "OWNER_EDITOR" },
    });
    await loginOwner({ ownerId: editor.id, role: "OWNER_EDITOR", name: editor.name });

    const r = await impersonate(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ userId: "x" }) }),
      { params: { id: "y" } },
    );
    expect(r.status).toBe(403);
  });

  it("404 TENANT_NOT_FOUND", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const r = await impersonate(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ userId: "x" }) }),
      { params: { id: "nope" } },
    );
    expect(r.status).toBe(404);
  });

  it("403 USER_NOT_IN_TENANT when target's centre belongs to a different org", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const orgA = await mkOrg("A");
    const orgB = await mkOrg("B");
    await mkCentre({ orgId: orgA.id });
    const centreB = await mkCentre({ orgId: orgB.id });
    const userInB = await mkUser({ role: "CENTRE_MANAGER", centreId: centreB.id });

    const r = await impersonate(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ userId: userInB.id }) }),
      { params: { id: orgA.id } },
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("USER_NOT_IN_TENANT");
  });

  it("happy path: mints tenant session w/ impersonatedBy, clears owner cookie, audits", async () => {
    const owner = await mkPlatformAdmin();
    await loginOwner({ ownerId: owner.id, role: "OWNER_ADMIN", name: owner.name });
    const org = await mkOrg("Acme");
    const centre = await mkCentre({ orgId: org.id });
    const target = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, name: "Tenant Boss" });

    const r = await impersonate(
      mockReq("http://localhost", { method: "POST", body: JSON.stringify({ userId: target.id }) }),
      { params: { id: org.id } },
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.redirect).toBe("/dashboard");

    // owner cookie cleared
    expect(cookieJar.has("ew_owner_session")).toBe(false);
    // tenant session present and carries impersonatedBy
    const tenantToken = cookieJar.get("ew_session")?.value;
    expect(tenantToken).toBeDefined();
    const decoded = await verifySession(tenantToken!);
    expect(decoded?.userId).toBe(target.id);
    expect(decoded?.impersonatedBy).toBe(owner.id);

    const log = await prisma.platformAuditLog.findFirstOrThrow({
      where: { orgId: org.id, action: "owner.impersonation_started" },
    });
    expect(log.actorId).toBe(owner.id);
  });
});

describe("POST /api/owner/impersonate/stop", () => {
  it("200 + notImpersonating when there's no impersonation session", async () => {
    const r = await stopImpersonating();
    expect(r.status).toBe(200);
    expect((await r.json()).notImpersonating).toBe(true);
  });

  it("restores owner cookie when called from an impersonated session", async () => {
    const owner = await mkPlatformAdmin();
    const centre = await mkCentre();
    const target = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });

    // Simulate having impersonated: tenant cookie present with impersonatedBy.
    const impersonatedToken = await signSession({
      userId: target.id,
      role: "CENTRE_MANAGER",
      centreId: centre.id,
      name: target.name,
      impersonatedBy: owner.id,
    } as SessionPayload);
    cookieJar.set("ew_session", { value: impersonatedToken });

    const r = await stopImpersonating();
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.redirect).toBe("/owner");

    // Owner cookie now present, tenant cookie cleared.
    expect(cookieJar.has("ew_owner_session")).toBe(true);
    expect(cookieJar.has("ew_session")).toBe(false);

    const log = await prisma.platformAuditLog.findFirstOrThrow({
      where: { action: "owner.impersonation_stopped" },
    });
    expect(log.actorId).toBe(owner.id);
  });
});
