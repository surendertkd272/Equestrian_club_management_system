import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkRider } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import { isReadOnlyStatus, getStatusForSession } from "@/lib/readonly-gate";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: createBatch } = await import("@/app/api/batches/route");
const { POST: createHorse } = await import("@/app/api/horses/route");
const { PATCH: patchCentre, DELETE: deleteCentre } = await import("@/app/api/centres/[id]/route");
const { POST: issuePortal } = await import("@/app/api/riders/[id]/portal-access/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

async function setOrgStatus(orgId: string, status: string) {
  await prisma.organisation.update({ where: { id: orgId }, data: { status } });
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("isReadOnlyStatus (pure)", () => {
  it("flags past_due and suspended as read-only", () => {
    expect(isReadOnlyStatus("past_due")).toBe(true);
    expect(isReadOnlyStatus("suspended")).toBe(true);
  });
  it("leaves active and trial writable", () => {
    expect(isReadOnlyStatus("active")).toBe(false);
    expect(isReadOnlyStatus("trial")).toBe(false);
    expect(isReadOnlyStatus(null)).toBe(false);
    expect(isReadOnlyStatus(undefined)).toBe(false);
  });
});

describe("getStatusForSession", () => {
  it("returns the active tenant's status", async () => {
    const centre = await mkCentre();
    await setOrgStatus(centre.orgId, "past_due");
    const s = await getStatusForSession({
      userId: "u",
      role: "COACH",
      centreId: centre.id,
      name: "C",
    });
    expect(s).toBe("past_due");
  });
});

describe("API gate: POST /api/batches under read-only", () => {
  it("403 READ_ONLY when status=suspended", async () => {
    const centre = await mkCentre();
    await setOrgStatus(centre.orgId, "suspended");
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createBatch(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Morning", dayOfWeek: "Mon", startTime: "06:00", endTime: "07:00" }),
      }),
    );
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "READ_ONLY", status: "suspended" });
  });

  it("403 READ_ONLY when status=past_due", async () => {
    const centre = await mkCentre();
    await setOrgStatus(centre.orgId, "past_due");
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createBatch(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Morning", dayOfWeek: "Mon", startTime: "06:00", endTime: "07:00" }),
      }),
    );
    expect(r.status).toBe(403);
    expect((await r.json()).status).toBe("past_due");
  });

  it("200 when status=trial (trial stays writable)", async () => {
    const centre = await mkCentre();
    await setOrgStatus(centre.orgId, "trial");
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createBatch(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Morning", dayOfWeek: "Mon", startTime: "06:00", endTime: "07:00" }),
      }),
    );
    expect(r.status).toBe(200);
  });
});

describe("API gate: feature-gated + read-only stack together", () => {
  it("POST /api/horses returns READ_ONLY even when the feature is on", async () => {
    const centre = await mkCentre();
    await setOrgStatus(centre.orgId, "suspended");
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createHorse(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Bijli" }),
      }),
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("READ_ONLY");
  });
});

describe("API gate: HQ-only writes", () => {
  it("PATCH /api/centres/[id] refused with READ_ONLY on suspended tenant", async () => {
    const centre = await mkCentre();
    await setOrgStatus(centre.orgId, "suspended");
    const sup = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    await loginAs({ userId: sup.id, role: "SUPER_ADMIN", centreId: null, name: sup.name });

    const r = await patchCentre(
      mockReq("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed" }),
      }),
      { params: { id: centre.id } },
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("READ_ONLY");
  });

  it("DELETE /api/centres/[id] refused with READ_ONLY", async () => {
    const centre = await mkCentre();
    await setOrgStatus(centre.orgId, "suspended");
    const sup = await mkUser({ role: "SUPER_ADMIN", centreId: null });
    await loginAs({ userId: sup.id, role: "SUPER_ADMIN", centreId: null, name: sup.name });

    const r = await deleteCentre(mockReq("http://localhost", { method: "DELETE" }), {
      params: { id: centre.id },
    });
    expect(r.status).toBe(403);
  });
});

describe("API gate: rider portal-access POST under read-only", () => {
  it("403 READ_ONLY", async () => {
    const centre = await mkCentre();
    await setOrgStatus(centre.orgId, "suspended");
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    const rider = await mkRider({ centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await issuePortal(
      mockReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "rider@x.test" }),
      }),
      { params: { id: rider.id } },
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("READ_ONLY");
  });
});
