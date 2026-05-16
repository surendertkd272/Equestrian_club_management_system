import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkRider, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import { filterSidebarNav } from "@/components/shell/sidebar-nav";
import { getFeaturesForSession, getOrgIdForSession } from "@/lib/features-gate";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: createCompetition } = await import("@/app/api/competitions/route");
const { POST: createHorse } = await import("@/app/api/horses/route");
const { GET: parentChildren } = await import("@/app/api/parent/children/route");

async function loginAs(payload: SessionPayload) {
  cookieJar.clear();
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

async function setOrgFeatures(orgId: string, enabledKeys: string[]) {
  // Seed every feature in the registry, defaulting to disabled unless listed.
  const { FEATURE_KEYS } = await import("@/lib/features");
  for (const k of FEATURE_KEYS) {
    await prisma.orgFeature.upsert({
      where: { orgId_featureKey: { orgId, featureKey: k } },
      create: { orgId, featureKey: k, enabled: enabledKeys.includes(k) },
      update: { enabled: enabledKeys.includes(k) },
    });
  }
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("filterSidebarNav (pure visibility helper)", () => {
  it("hides Competitions when the feature is off, even for a competition_manager", () => {
    const groups = filterSidebarNav("COMPETITION_MANAGER", new Set());
    const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(allHrefs).not.toContain("/competitions");
  });

  it("shows Competitions when the feature is on", () => {
    const groups = filterSidebarNav("COMPETITION_MANAGER", new Set(["competitions"]));
    const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(allHrefs).toContain("/competitions");
  });

  it("hides Horses + Medicines + Tack + Exams when their features are all off", () => {
    const groups = filterSidebarNav("CENTRE_MANAGER", new Set());
    const all = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(all).not.toContain("/horses");
    expect(all).not.toContain("/medicines");
    expect(all).not.toContain("/tack");
    expect(all).not.toContain("/exams");
  });

  it("hides empty groups entirely", () => {
    // SUPER_ADMIN with NO features should still see HQ-only items (Clubs / Users)
    // because those aren't feature-gated.
    const groups = filterSidebarNav("SUPER_ADMIN", new Set());
    const overview = groups.find((g) => g.group === "Overview");
    expect(overview).toBeDefined();
    expect(overview!.items.map((i) => i.href)).toContain("/centres");
  });
});

describe("getOrgIdForSession", () => {
  it("resolves orgId via session.centreId", async () => {
    const centre = await mkCentre();
    const r = await getOrgIdForSession({
      userId: "u1",
      role: "COACH",
      centreId: centre.id,
      name: "C",
    });
    expect(r).toBe(centre.orgId);
  });

  it("resolves orgId for SUPER_ADMIN via the first centre under any org", async () => {
    const centre = await mkCentre();
    const r = await getOrgIdForSession({
      userId: "u1",
      role: "SUPER_ADMIN",
      centreId: null,
      name: "Super",
    });
    expect(r).toBe(centre.orgId);
  });

  it("resolves orgId for RIDER via Rider.userId → centre → org", async () => {
    const centre = await mkCentre();
    const rider = await mkRider({ centreId: centre.id });
    const u = await mkUser({ role: "RIDER", centreId: centre.id });
    await prisma.rider.update({ where: { id: rider.id }, data: { userId: u.id } });

    const r = await getOrgIdForSession({
      userId: u.id,
      role: "RIDER",
      centreId: null,
      name: u.name,
    });
    expect(r).toBe(centre.orgId);
  });
});

describe("API gate: POST /api/competitions", () => {
  it("403 FEATURE_DISABLED when competitions is off for the org", async () => {
    const centre = await mkCentre();
    await setOrgFeatures(centre.orgId, []); // everything off
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createCompetition(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "C1",
          slug: "c1",
          scope: "internal",
          startDate: "2026-06-01",
          endDate: "2026-06-02",
          classes: [{ name: "Open", fee: 0 }],
        }),
      }) as any,
    );
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "FEATURE_DISABLED", featureKey: "competitions" });
  });

  it("passes through to the existing handler when competitions is on", async () => {
    const centre = await mkCentre();
    await setOrgFeatures(centre.orgId, ["competitions"]);
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createCompetition(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "C1",
          slug: "c1-on",
          scope: "internal",
          startDate: "2026-06-01",
          endDate: "2026-06-02",
          classes: [{ name: "Open", fee: 0 }],
        }),
      }) as any,
    );
    expect(r.status).toBe(200);
  });
});

describe("API gate: POST /api/horses", () => {
  it("403 FEATURE_DISABLED when horse-management is off", async () => {
    const centre = await mkCentre();
    await setOrgFeatures(centre.orgId, []);
    const mgr = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id });
    await loginAs({ userId: mgr.id, role: "CENTRE_MANAGER", centreId: centre.id, name: mgr.name });

    const r = await createHorse(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Bijli" }),
      }) as any,
    );
    expect(r.status).toBe(403);
    expect((await r.json()).featureKey).toBe("horse-management");
  });
});

describe("API gate: GET /api/parent/children", () => {
  it("403 FEATURE_DISABLED when parent-portal is off", async () => {
    const centre = await mkCentre();
    await setOrgFeatures(centre.orgId, []);
    const rider = await mkRider({ centreId: centre.id });
    const parent = await mkUser({ role: "PARENT" });
    await prisma.parentLink.create({
      data: { parentUserId: parent.id, riderId: rider.id, relationship: "father" },
    });
    await loginAs({ userId: parent.id, role: "PARENT", centreId: null, name: parent.name });

    const r = await parentChildren(new Request("http://localhost") as any);
    expect(r.status).toBe(403);
    expect((await r.json()).featureKey).toBe("parent-portal");
  });

  it("200 when parent-portal is on", async () => {
    const centre = await mkCentre();
    await setOrgFeatures(centre.orgId, ["parent-portal"]);
    const rider = await mkRider({ centreId: centre.id });
    const parent = await mkUser({ role: "PARENT" });
    await prisma.parentLink.create({
      data: { parentUserId: parent.id, riderId: rider.id, relationship: "father" },
    });
    await loginAs({ userId: parent.id, role: "PARENT", centreId: null, name: parent.name });

    const r = await parentChildren(new Request("http://localhost") as any);
    expect(r.status).toBe(200);
  });
});

describe("getFeaturesForSession", () => {
  it("returns the enabled set for a tenant", async () => {
    const centre = await mkCentre();
    await setOrgFeatures(centre.orgId, ["parent-portal", "competitions"]);
    const set = await getFeaturesForSession({
      userId: "u",
      role: "COACH",
      centreId: centre.id,
      name: "C",
    });
    expect(set.has("parent-portal")).toBe(true);
    expect(set.has("competitions")).toBe(true);
    expect(set.has("inventory")).toBe(false);
  });
});
