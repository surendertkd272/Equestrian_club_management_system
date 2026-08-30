// Cross-tenant isolation in the nightly batch.
//
// Sweeps are the easiest place in the system to leak between tenants, because
// they run unauthenticated over EVERY organisation's rows at once. There is no
// session to bind an org from, so nothing catches a missing filter — and the
// evidence lands in somebody else's notification inbox, where the person who
// would notice never sees it.
//
// This is a real bug that shipped: sweepOnboardingDocsOverdue fetched every
// SUPER_ADMIN/ADMIN on the platform in one unscoped query and notified all of
// them about every overdue row, so one club's HQ received another club's
// employee name, email, and pending-document list. Nightly.

import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { sweepOnboardingDocsOverdue } from "@/lib/sweeps/onboarding-docs-overdue";

/** A club with an HQ admin, a centre manager, and an overdue new hire. */
async function clubWithOverdueHire(name: string, hireName: string) {
  const org = await mkOrg(name);
  const centre = await mkCentre({ orgId: org.id, name: `${name} Centre` });
  const hq = await mkUser({
    role: "SUPER_ADMIN",
    centreId: null,
    orgId: org.id,
    email: `hq@${name.toLowerCase().replace(/\W/g, "")}.in`,
  });
  const manager = await mkUser({
    role: "CENTRE_MANAGER",
    centreId: centre.id,
    email: `mgr@${name.toLowerCase().replace(/\W/g, "")}.in`,
  });
  await prisma.centre.update({ where: { id: centre.id }, data: { managerId: manager.id } });

  await prisma.employeeOnboarding.create({
    data: {
      centreId: centre.id,
      // Required by the model — an onboarding row is created from an invite link.
      tokenHash: `hash_${hireName.toLowerCase().replace(/\W/g, "")}`,
      expiresAt: new Date(Date.now() + 30 * 86400_000),
      fullName: hireName,
      email: `${hireName.toLowerCase().replace(/\W/g, "")}@hire.in`,
      status: "approved",
      // Deadline passed, never chased.
      documentsDueAt: new Date(Date.now() - 5 * 86400_000),
      overdueNotifiedAt: null,
    },
  });
  return { org, centre, hq, manager, hireName };
}

beforeEach(async () => {
  await resetDb();
});

describe("sweepOnboardingDocsOverdue stays inside one tenant", () => {
  it("never tells one club's HQ about another club's hire", async () => {
    const alpha = await clubWithOverdueHire("Alpha Club", "Ravi Kumar");
    const beta = await clubWithOverdueHire("Beta Club", "Asha Rao");

    await sweepOnboardingDocsOverdue();

    const alphaNotifs = await prisma.notification.findMany({ where: { userId: alpha.hq.id } });
    const betaNotifs = await prisma.notification.findMany({ where: { userId: beta.hq.id } });

    // Each HQ hears about their own hire...
    expect(alphaNotifs.some((n) => n.title.includes("Ravi Kumar"))).toBe(true);
    expect(betaNotifs.some((n) => n.title.includes("Asha Rao"))).toBe(true);

    // ...and nothing at all about the other club's. This is the assertion the
    // leak would have failed: another tenant's employee name in an inbox.
    expect(alphaNotifs.some((n) => n.title.includes("Asha Rao"))).toBe(false);
    expect(betaNotifs.some((n) => n.title.includes("Ravi Kumar"))).toBe(false);
  });

  it("still reaches the HQ of the club that owns the hire", async () => {
    // The fix must not overcorrect into silence — an org-scoped lookup that
    // matched nothing would look identical to "no leak" from the test above.
    const alpha = await clubWithOverdueHire("Solo Club", "Nilesh Patel");
    const res = await sweepOnboardingDocsOverdue();

    expect(res.notified).toBe(1);
    const notifs = await prisma.notification.findMany({ where: { userId: alpha.hq.id } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toContain("Nilesh Patel");
  });

  it("still notifies the centre manager", async () => {
    const alpha = await clubWithOverdueHire("Mgr Club", "Sita Devi");
    await sweepOnboardingDocsOverdue();
    const notifs = await prisma.notification.findMany({ where: { userId: alpha.manager.id } });
    expect(notifs.some((n) => n.title.includes("Sita Devi"))).toBe(true);
  });

  it("marks the row so a second run does not chase it again", async () => {
    await clubWithOverdueHire("Dedup Club", "Repeat Hire");
    expect((await sweepOnboardingDocsOverdue()).notified).toBe(1);
    // A nightly job that re-notifies every night teaches people to ignore it.
    expect((await sweepOnboardingDocsOverdue()).notified).toBe(0);
  });
});
