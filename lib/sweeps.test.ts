import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sweepFeeDue,
  sweepMedicineExpiry,
  sweepAbsenceEscalation,
  sweepBirthdays,
  sweepMonthlyReports,
} from "./sweeps";
import { prisma } from "./prisma";
import { resetDb } from "../tests/helpers/db";
import { mkCentreWithManager, mkRider, mkBatch } from "../tests/helpers/fixtures";

beforeEach(async () => {
  await resetDb();
  // Silence dry-run dispatchers; they log to console which is noise in the test output.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe("sweepFeeDue", () => {
  it("notifies the centre manager for an invoice due in 2 days", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    await prisma.invoice.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        amount: 3000,
        kind: "monthly",
        status: "due",
        dueDate: new Date(Date.now() + 2 * ONE_DAY_MS),
      },
    });

    const res = await sweepFeeDue();
    expect(res).toMatchObject({ job: "fee_due", scanned: 1, notified: 1, skipped: 0 });

    const notifs = await prisma.notification.findMany({ where: { type: "invoice.due_soon" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(manager.id);
    expect(notifs[0].centreId).toBe(centre.id);
  });

  it("ignores invoices outside the 1-4 day window", async () => {
    const { centre } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    // Today (< 1 day): not yet in window per `gte: now+24h`
    await prisma.invoice.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        amount: 1000,
        kind: "monthly",
        status: "due",
        dueDate: new Date(Date.now() + 3 * 60 * 60 * 1000),
      },
    });
    // 6 days away — past the upper bound.
    await prisma.invoice.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        amount: 2000,
        kind: "monthly",
        status: "due",
        dueDate: new Date(Date.now() + 6 * ONE_DAY_MS),
      },
    });
    // Already paid → status filter excludes.
    await prisma.invoice.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        amount: 4000,
        kind: "monthly",
        status: "paid",
        dueDate: new Date(Date.now() + 2 * ONE_DAY_MS),
      },
    });

    const res = await sweepFeeDue();
    expect(res).toMatchObject({ scanned: 0, notified: 0, skipped: 0 });
    expect(await prisma.notification.count()).toBe(0);
  });

  it("is idempotent — second run within 23h skips the same invoice", async () => {
    const { centre } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    await prisma.invoice.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        amount: 3000,
        kind: "monthly",
        status: "due",
        dueDate: new Date(Date.now() + 2 * ONE_DAY_MS),
      },
    });

    const first = await sweepFeeDue();
    expect(first.notified).toBe(1);
    const second = await sweepFeeDue();
    expect(second).toMatchObject({ scanned: 1, notified: 0, skipped: 1 });

    expect(await prisma.notification.count()).toBe(1);
  });

  it("skips invoices whose centre has no manager", async () => {
    // Centre exists but no managerId is set.
    const org = await prisma.organisation.create({ data: { name: "Org X", slug: `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } });
    const centre = await prisma.centre.create({
      data: { orgId: org.id, name: "No-Manager Centre", slug: `nm-${Date.now()}` },
    });
    const rider = await mkRider({ centreId: centre.id });
    await prisma.invoice.create({
      data: {
        centreId: centre.id,
        riderId: rider.id,
        amount: 1000,
        kind: "monthly",
        status: "due",
        dueDate: new Date(Date.now() + 2 * ONE_DAY_MS),
      },
    });

    const res = await sweepFeeDue();
    expect(res).toMatchObject({ scanned: 1, notified: 0, skipped: 1 });
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe("sweepMedicineExpiry", () => {
  it("emits one digest per centre listing meds expiring within 30 days", async () => {
    const { centre, manager } = await mkCentreWithManager();
    await prisma.medicine.createMany({
      data: [
        {
          centreId: centre.id,
          name: "Phenylbutazone",
          category: "nsaid",
          batchNo: "B-1",
          expDate: new Date(Date.now() + 10 * ONE_DAY_MS),
          qty: 5,
        },
        {
          centreId: centre.id,
          name: "Banamine",
          category: "nsaid",
          batchNo: "B-2",
          expDate: new Date(Date.now() + 20 * ONE_DAY_MS),
          qty: 2,
        },
      ],
    });

    const res = await sweepMedicineExpiry();
    expect(res).toMatchObject({ job: "medicine_expiry", scanned: 2, notified: 1 });
    const notifs = await prisma.notification.findMany({ where: { type: "medicine.expiry_digest" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(manager.id);
    expect(notifs[0].title).toContain("2 medicines");
  });

  it("excludes meds with qty=0", async () => {
    const { centre } = await mkCentreWithManager();
    await prisma.medicine.create({
      data: {
        centreId: centre.id,
        name: "Empty Bottle",
        category: "wound",
        batchNo: "B-Z",
        expDate: new Date(Date.now() + 10 * ONE_DAY_MS),
        qty: 0,
      },
    });
    const res = await sweepMedicineExpiry();
    expect(res).toMatchObject({ scanned: 0, notified: 0 });
  });

  it("excludes meds expiring past the 30-day window", async () => {
    const { centre } = await mkCentreWithManager();
    await prisma.medicine.create({
      data: {
        centreId: centre.id,
        name: "Long-life",
        category: "supplement",
        batchNo: "B-LL",
        expDate: new Date(Date.now() + 60 * ONE_DAY_MS),
        qty: 5,
      },
    });
    expect(await sweepMedicineExpiry()).toMatchObject({ scanned: 0, notified: 0 });
  });
});

describe("sweepAbsenceEscalation", () => {
  it("flags a rider with 3+ absences in last 5 sessions", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    const batch = await mkBatch({ centreId: centre.id });

    // Last 5 sessions: A, A, P, A, P (3 absent)
    const statuses = ["absent", "absent", "present", "absent", "present"];
    for (let i = 0; i < statuses.length; i++) {
      await prisma.attendance.create({
        data: {
          riderId: rider.id,
          batchId: batch.id,
          date: new Date(Date.now() - i * ONE_DAY_MS),
          status: statuses[i],
        },
      });
    }

    const res = await sweepAbsenceEscalation();
    expect(res.notified).toBe(1);
    const notifs = await prisma.notification.findMany({ where: { type: "rider.absence_streak" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(manager.id);
  });

  it("does not flag a rider with only 2 absences in last 5", async () => {
    const { centre } = await mkCentreWithManager();
    const rider = await mkRider({ centreId: centre.id });
    const batch = await mkBatch({ centreId: centre.id });

    const statuses = ["absent", "absent", "present", "present", "present"];
    for (let i = 0; i < statuses.length; i++) {
      await prisma.attendance.create({
        data: {
          riderId: rider.id,
          batchId: batch.id,
          date: new Date(Date.now() - i * ONE_DAY_MS),
          status: statuses[i],
        },
      });
    }
    const res = await sweepAbsenceEscalation();
    expect(res.notified).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe("sweepBirthdays", () => {
  it("notifies the manager when a rider's DOB month+day match today", async () => {
    const { centre, manager } = await mkCentreWithManager();
    const today = new Date();
    // DOB month/day = today; year arbitrary (15y old).
    const dob = new Date(today.getFullYear() - 15, today.getMonth(), today.getDate());
    await mkRider({ centreId: centre.id, dob });

    const res = await sweepBirthdays();
    expect(res.notified).toBe(1);
    const notifs = await prisma.notification.findMany({ where: { type: "rider.birthday" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(manager.id);
  });

  it("does not notify when DOB doesn't match today", async () => {
    const { centre } = await mkCentreWithManager();
    const today = new Date();
    // Always 7 days away → different day-of-month, never today.
    const dob = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate() + 7);
    await mkRider({ centreId: centre.id, dob });
    expect((await sweepBirthdays()).notified).toBe(0);
  });
});

describe("sweepMonthlyReports", () => {
  // The "not 1st of month" gate is calendar-dependent; skip the gate test on the 1st itself.
  const isFirstOfMonth = new Date().getDate() === 1;

  it.skipIf(isFirstOfMonth)("returns early when not 1st of month and no force flag", async () => {
    const res = await sweepMonthlyReports();
    expect(res).toMatchObject({ scanned: 0, notified: 0, skipped: 0, details: "not first of month" });
  });

  it("with force=true: sends a report email per active rider with an address", async () => {
    const { centre, manager } = await mkCentreWithManager();
    await mkRider({ centreId: centre.id, email: "parent@test.local" });
    await mkRider({ centreId: centre.id, email: null }); // skipped — no email

    const res = await sweepMonthlyReports({ force: true });
    expect(res.scanned).toBe(2);
    expect(res.notified).toBe(1);
    expect(res.skipped).toBe(1);

    const notifs = await prisma.notification.findMany({ where: { type: "report.monthly_email" } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(manager.id);
  });
});
