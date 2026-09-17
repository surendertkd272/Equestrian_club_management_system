// The school portal's numbers.
//
// A partner school reads two things off this page: how much riding a child has
// actually had, and which of their students are stuck. Both were wrong.
//
// The attendance column was labelled "Attended This Month" and counted every
// attendance row for the month regardless of status — so a child marked absent
// six times out of eight displayed as 8. That is not a rounding error; it is
// the opposite of the truth, on the one figure a school would act on, for
// exactly the children whose absence someone needed to notice.
//
// These test the aggregation the page performs, against real rows.

import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "../helpers/db";
import { mkOrg, mkCentre, mkRider, mkBatch } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { ENROLLED_RIDER_STATUSES, RIDER_STATUS } from "@/lib/rider-status";

let centre: Awaited<ReturnType<typeof mkCentre>>;
let batch: Awaited<ReturnType<typeof mkBatch>>;

beforeEach(async () => {
  await resetDb();
  const org = await mkOrg("School Org");
  centre = await mkCentre({ orgId: org.id, name: "School Centre" });
  batch = await mkBatch({ centreId: centre.id, name: "Morning" });
});

/** The exact roll-up app/school/page.tsx performs. */
async function attendanceRollup(centreId: string, monthStart: Date) {
  const rows = await prisma.attendance.groupBy({
    by: ["riderId", "status"],
    where: { date: { gte: monthStart }, batch: { centreId } },
    _count: { _all: true },
  });
  const ATTENDED = new Set(["present", "late"]);
  const byRider = new Map<string, { attended: number; total: number }>();
  for (const a of rows) {
    const row = byRider.get(a.riderId) ?? { attended: 0, total: 0 };
    row.total += a._count._all;
    if (ATTENDED.has(a.status)) row.attended += a._count._all;
    byRider.set(a.riderId, row);
  }
  return byRider;
}

const monthStart = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
};

async function mark(riderId: string, day: number, status: string) {
  const n = new Date();
  await prisma.attendance.create({
    data: {
      riderId,
      batchId: batch.id,
      date: new Date(n.getFullYear(), n.getMonth(), day),
      status,
    },
  });
}

describe("what 'attended' means", () => {
  it("does not count an absence as attendance", async () => {
    const rider = await mkRider({ centreId: centre.id, firstName: "Absent", lastName: "Child" });
    await mark(rider.id, 1, "present");
    await mark(rider.id, 2, "absent");
    await mark(rider.id, 3, "absent");
    await mark(rider.id, 4, "absent");

    const roll = await attendanceRollup(centre.id, monthStart());
    const r = roll.get(rider.id)!;
    // Before the fix this read 4 — the child who came once looked identical to
    // the child who came four times.
    expect(r.attended).toBe(1);
    expect(r.total).toBe(4);
  });

  it("counts a late arrival as having turned up", async () => {
    const rider = await mkRider({ centreId: centre.id, firstName: "Late", lastName: "Child" });
    await mark(rider.id, 1, "present");
    await mark(rider.id, 2, "late");

    const roll = await attendanceRollup(centre.id, monthStart());
    expect(roll.get(rider.id)!.attended).toBe(2);
  });

  it("counts an excused session in the denominator but not the numerator", async () => {
    // Excused is a real absence with a good reason. A school asking how much
    // riding a child has had wants the honest number on both halves.
    const rider = await mkRider({ centreId: centre.id, firstName: "Excused", lastName: "Child" });
    await mark(rider.id, 1, "present");
    await mark(rider.id, 2, "excused");

    const roll = await attendanceRollup(centre.id, monthStart());
    const r = roll.get(rider.id)!;
    expect(r.attended).toBe(1);
    expect(r.total).toBe(2);
  });

  it("ignores another centre's register", async () => {
    const otherOrg = await mkOrg("Other School Org");
    const otherCentre = await mkCentre({ orgId: otherOrg.id, name: "Other" });
    const otherBatch = await mkBatch({ centreId: otherCentre.id, name: "Theirs" });
    const theirRider = await mkRider({ centreId: otherCentre.id, firstName: "Not", lastName: "Ours" });
    const n = new Date();
    await prisma.attendance.create({
      data: {
        riderId: theirRider.id,
        batchId: otherBatch.id,
        date: new Date(n.getFullYear(), n.getMonth(), 1),
        status: "present",
      },
    });

    const roll = await attendanceRollup(centre.id, monthStart());
    expect(roll.has(theirRider.id)).toBe(false);
  });
});

describe("which students the school is shown", () => {
  it("lists enrolled riders using the shared status list", async () => {
    // Hardcoding ["active","pending_payment"] here is how this page silently
    // fell behind the lifecycle when pending_consent was introduced.
    const active = await mkRider({ centreId: centre.id, firstName: "A", status: "active" });
    const unpaid = await mkRider({
      centreId: centre.id,
      firstName: "B",
      status: "pending_payment",
    });
    await mkRider({ centreId: centre.id, firstName: "C", status: RIDER_STATUS.PENDING_CONSENT });

    const listed = await prisma.rider.findMany({
      where: { centreId: centre.id, status: { in: [...ENROLLED_RIDER_STATUSES] } },
      select: { id: true },
    });
    expect(listed.map((r) => r.id).sort()).toEqual([active.id, unpaid.id].sort());
  });

  it("surfaces the students held for consent separately", async () => {
    // These are invisible on every other school-facing surface by design —
    // which is right for a coach's register and wrong for the school, who are
    // the only people who can chase the parent.
    const held = await mkRider({
      centreId: centre.id,
      firstName: "Held",
      status: RIDER_STATUS.PENDING_CONSENT,
    });
    await mkRider({ centreId: centre.id, firstName: "Fine", status: "active" });

    const rows = await prisma.rider.findMany({
      where: { centreId: centre.id, status: RIDER_STATUS.PENDING_CONSENT },
      select: { id: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(held.id);
  });
});

describe("naming a rider on an exam", () => {
  it("names riders the enrolled list would not contain", async () => {
    // The page used to find the rider inside its own 200-row enrolled list, so
    // a withdrawn rider's exam rendered as a raw cuid on a partner school's
    // dashboard.
    const gone = await mkRider({ centreId: centre.id, firstName: "Left", lastName: "Club" });
    await prisma.rider.update({ where: { id: gone.id }, data: { status: "withdrawn" } });
    await prisma.exam.create({
      data: {
        centreId: centre.id,
        riderId: gone.id,
        examinerName: "E",
        level: 2,
        date: new Date(),
        status: "completed",
      },
    });

    const exams = await prisma.exam.findMany({
      where: { centreId: centre.id },
      include: { rider: { select: { firstName: true, lastName: true } } },
    });
    expect(exams).toHaveLength(1);
    expect(exams[0].rider.firstName).toBe("Left");
  });
});
