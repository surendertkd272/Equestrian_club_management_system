// Nagging about self-enrolments nobody has answered.
//
// Two riders sat in pending_approval for over two months on the live system —
// applied 17 June and 30 June, never approved, never rejected. Nothing chased
// them because no sweep looked at this queue at all. A public sign-up form
// that silently swallows applications is worse than not having one: the family
// believes they have joined, and the club never learns they applied.

import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider, mkUser } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { sweepEnrolmentStale } from "@/lib/sweeps/enrolment-stale";

let org: Awaited<ReturnType<typeof mkOrg>>;
let centre: Awaited<ReturnType<typeof mkCentre>>;
let manager: Awaited<ReturnType<typeof mkUser>>;
let hq: Awaited<ReturnType<typeof mkUser>>;

async function pending(name: string, daysAgo: number) {
  const r = await mkRider({ centreId: centre.id, firstName: name });
  return prisma.rider.update({
    where: { id: r.id },
    data: {
      status: "pending_approval",
      selfEnrolled: true,
      createdAt: new Date(Date.now() - daysAgo * 86400_000),
    },
  });
}

beforeEach(async () => {
  await resetDb();
  org = await mkOrg("Stale Club");
  centre = await mkCentre({ orgId: org.id, name: "Stale Centre" });
  manager = await mkUser({ role: "CENTRE_MANAGER", centreId: centre.id, email: "m@s.in" });
  await prisma.centre.update({ where: { id: centre.id }, data: { managerId: manager.id } });
  hq = await mkUser({ role: "SUPER_ADMIN", centreId: null, orgId: org.id, email: "hq@s.in" });
});

describe("sweepEnrolmentStale", () => {
  it("chases an application nobody has answered", async () => {
    await pending("Surender", 74);
    const res = await sweepEnrolmentStale();
    expect(res.scanned).toBe(1);
    expect(res.notified).toBe(1);

    const mgrNotifs = await prisma.notification.findMany({ where: { userId: manager.id } });
    expect(mgrNotifs.some((n) => n.type === "enrolment.stale")).toBe(true);
    // Says how long, because "1 waiting" and "1 waiting for 74 days" prompt
    // very different responses.
    expect(mgrNotifs[0].body).toContain("74 days");
  });

  it("also tells HQ, for a centre with no manager watching", async () => {
    await pending("Ahmad", 60);
    await sweepEnrolmentStale();
    const hqNotifs = await prisma.notification.findMany({ where: { userId: hq.id } });
    expect(hqNotifs.some((n) => n.type === "enrolment.stale")).toBe(true);
  });

  it("leaves a fresh application alone", async () => {
    // Someone who applied this morning is not neglected, they are simply new.
    await pending("Fresh", 1);
    const res = await sweepEnrolmentStale();
    expect(res.scanned).toBe(0);
    expect(res.notified).toBe(0);
  });

  it("groups a queue into one message per centre", async () => {
    await pending("A", 10);
    await pending("B", 20);
    await pending("C", 30);
    await sweepEnrolmentStale();
    const mgrNotifs = await prisma.notification.findMany({ where: { userId: manager.id } });
    // Three notifications for three applicants is how a queue becomes noise.
    expect(mgrNotifs).toHaveLength(1);
    expect(mgrNotifs[0].title).toContain("3 enrolments");
    // Oldest first — that is the one at risk of being written off entirely.
    expect(mgrNotifs[0].body).toContain("30 days");
  });

  it("does not nag every night", async () => {
    await pending("Repeat", 10);
    expect((await sweepEnrolmentStale()).notified).toBe(1);
    const second = await sweepEnrolmentStale();
    // A daily reminder about the same queue is one people learn to dismiss.
    expect(second.notified).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("ignores riders who were already dealt with", async () => {
    const r = await pending("Approved", 30);
    await prisma.rider.update({ where: { id: r.id }, data: { status: "active" } });
    expect((await sweepEnrolmentStale()).scanned).toBe(0);
  });
});
