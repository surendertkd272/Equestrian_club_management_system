// Regression: /injuries and /teams crashed because tenantWhere() emits a
// `centre: { orgId }` relation filter, but InjuryLog and Team had no `centre`
// relation → Prisma threw "Unknown argument `centre`" at runtime. These tests
// run the exact query shape and would throw on the pre-fix schema; they also
// confirm the org-scope actually isolates a second org's rows.

import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { tenantWhere } from "@/lib/tenancy";

beforeEach(async () => {
  await resetDb();
});

describe("centre-owned org scope: InjuryLog", () => {
  it("tenantWhere filters by org (no 'Unknown argument centre' throw) and isolates other orgs", async () => {
    const orgA = await mkOrg("Org A");
    const orgB = await mkOrg("Org B");
    const cA = await mkCentre({ orgId: orgA.id });
    const cB = await mkCentre({ orgId: orgB.id });
    await prisma.injuryLog.create({ data: { centreId: cA.id, subjectType: "horse", subjectId: "h1", occurredAt: new Date(), initialNotes: "A" } });
    await prisma.injuryLog.create({ data: { centreId: cB.id, subjectType: "horse", subjectId: "h2", occurredAt: new Date(), initialNotes: "B" } });

    // HQ "all centres" for org A → org-bounded (not global), and must not throw.
    const all = await prisma.injuryLog.findMany({ where: tenantWhere(null, orgA.id) });
    expect(all).toHaveLength(1);
    expect(all[0].centreId).toBe(cA.id);

    // specific centre in-org → its rows
    expect(await prisma.injuryLog.findMany({ where: tenantWhere(cA.id, orgA.id) })).toHaveLength(1);
    // a foreign org's centre id, scoped to org A → 0 rows (can't leak)
    expect(await prisma.injuryLog.findMany({ where: tenantWhere(cB.id, orgA.id) })).toHaveLength(0);
  });
});

describe("centre-owned org scope: Team", () => {
  it("tenantWhere filters by org without throwing, and isolates other orgs", async () => {
    const orgA = await mkOrg("Org A");
    const orgB = await mkOrg("Org B");
    const cA = await mkCentre({ orgId: orgA.id });
    const cB = await mkCentre({ orgId: orgB.id });
    await prisma.team.create({ data: { centreId: cA.id, name: "A team" } });
    await prisma.team.create({ data: { centreId: cB.id, name: "B team" } });

    const all = await prisma.team.findMany({ where: tenantWhere(null, orgA.id) });
    expect(all).toHaveLength(1);
    expect(all[0].centreId).toBe(cA.id);
    expect(await prisma.team.findMany({ where: tenantWhere(cB.id, orgA.id) })).toHaveLength(0);
  });
});
