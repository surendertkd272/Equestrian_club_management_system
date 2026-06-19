// Regression: HQ (SUPER_ADMIN/ADMIN) must see inspections (AuditRun) org-wide
// when no centre is picked.
//
// Bug: the /inspections page early-returned a "Pick a centre…" card whenever
// scopeCentre() was null (an HQ user who hadn't picked a centre), so the
// auditRun query never ran and an INSPECTION_OFFICER's inspection was invisible
// at HQ. Fix: resolve org first, then let a null centre fall through to the
// org-wide tenantWhere(null, orgId) => { centre: { orgId } } filter. That
// visibility rule now lives in loadInspectionRuns (lib/inspections.ts), which
// the page renders verbatim — so testing it here covers the real code path.
//
// RLS is off under vitest, so this verifies the APP-LAYER tenantWhere filter
// (the primary control); RLS is the backstop in prod.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";
import { loadInspectionRuns } from "@/lib/inspections";

// loadInspectionRuns calls getOrgIdForSession, which reads the request cookies
// via next/headers in some paths; mock it the same way the API-route tests do.
const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

async function mkRun(centreId: string, inspectorUserId: string, scope = "inventory") {
  return prisma.auditRun.create({ data: { centreId, inspectorUserId, scope } });
}

async function visibleRunIds(session: SessionPayload): Promise<string[]> {
  const { runs } = await loadInspectionRuns(session);
  return runs.map((r) => r.id);
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

describe("loadInspectionRuns — /inspections visibility", () => {
  it("SUPER_ADMIN with no centre picked sees audit runs from ALL centres in their org (the bug)", async () => {
    const org = await mkOrg();
    const centreA = await mkCentre({ orgId: org.id });
    const centreB = await mkCentre({ orgId: org.id });
    const officer = await mkUser({ role: "INSPECTION_OFFICER", centreId: centreA.id });
    const runA = await mkRun(centreA.id, officer.id, "inventory");
    const runB = await mkRun(centreB.id, officer.id, "stable");
    const sup = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });

    const ids = await visibleRunIds({ userId: sup.id, role: "SUPER_ADMIN", centreId: null, name: sup.name });

    expect(ids).toEqual(expect.arrayContaining([runA.id, runB.id]));
    expect(ids).toHaveLength(2);
  });

  it("does NOT leak another org's audit runs to a SUPER_ADMIN (org-bounded)", async () => {
    const foreignOrg = await mkOrg();
    const foreignCentre = await mkCentre({ orgId: foreignOrg.id });
    const foreignOfficer = await mkUser({ role: "INSPECTION_OFFICER", centreId: foreignCentre.id });
    const foreignRun = await mkRun(foreignCentre.id, foreignOfficer.id);

    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const officer = await mkUser({ role: "INSPECTION_OFFICER", centreId: centre.id });
    const ownRun = await mkRun(centre.id, officer.id);
    const sup = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id });

    const ids = await visibleRunIds({ userId: sup.id, role: "SUPER_ADMIN", centreId: null, name: sup.name });

    expect(ids).toContain(ownRun.id);
    expect(ids).not.toContain(foreignRun.id);
  });

  it("INSPECTION_OFFICER sees only their own centre's runs (not widened by the fix)", async () => {
    const org = await mkOrg();
    const centreA = await mkCentre({ orgId: org.id });
    const centreB = await mkCentre({ orgId: org.id });
    const officer = await mkUser({ role: "INSPECTION_OFFICER", centreId: centreA.id });
    const runA = await mkRun(centreA.id, officer.id, "inventory");
    await mkRun(centreB.id, officer.id, "stable"); // different centre — must not appear

    const ids = await visibleRunIds({ userId: officer.id, role: "INSPECTION_OFFICER", centreId: centreA.id, name: officer.name });

    expect(ids).toEqual([runA.id]);
  });
});
