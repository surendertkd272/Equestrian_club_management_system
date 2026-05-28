// Smoke tests for POST /api/salary.
//
// Real fixture setup needed: Org + Centre + staff User + SalaryStructure +
// PayrollConfig (deductionRulesJson). We don't load StaffAttendance —
// without those rows attendanceCounts() returns {}, so attendanceDeducted
// computes to 0 and the test stays focused on the gross-net arithmetic +
// the policy / dedup guards.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db";
import { mkCentre, mkUser, mkOrg } from "../helpers/fixtures";
import { prisma } from "@/lib/prisma";
import { signSession, type SessionPayload } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { mockReq } from "../helpers/request";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const { POST: postSalary } = await import("@/app/api/salary/route");

async function signInAs(user: { id: string; role: string; centreId: string | null; name: string }) {
  cookieJar.clear();
  const payload: SessionPayload = {
    userId: user.id,
    role: user.role as Role,
    centreId: user.centreId,
    name: user.name,
  };
  cookieJar.set("ew_session", { value: await signSession(payload) });
}

function jsonReq(url: string, body: unknown) {
  return mockReq(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Shared scaffold: org + centre + accountant (caller) + coach (the staff
// member whose salary we're recording) + their salary structure + the
// org-level payroll config (no deductions, keeps the arithmetic clean).
async function scaffold(opts: { monthlySalary?: number; deductionRules?: Record<string, number> } = {}) {
  const org = await mkOrg();
  const centre = await mkCentre({ orgId: org.id });
  const accountant = await mkUser({ role: "ACCOUNTANT", centreId: centre.id });
  const coach = await mkUser({ role: "COACH", centreId: centre.id });
  await prisma.salaryStructure.create({
    data: {
      userId: coach.id,
      centreId: centre.id,
      monthlySalary: opts.monthlySalary ?? 30_000,
      effectiveFrom: new Date("2026-01-01"),
      createdByUserId: accountant.id,
    },
  });
  await prisma.payrollConfig.create({
    data: {
      orgId: org.id,
      deductionRulesJson: opts.deductionRules ?? {},
      updatedByUserId: accountant.id,
    },
  });
  return { org, centre, accountant, coach };
}

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/salary", () => {
  it("records a salary payment with the gross from the active structure", async () => {
    const { centre, accountant, coach } = await scaffold({ monthlySalary: 30_000 });
    await signInAs(accountant);

    const res = await postSalary(
      jsonReq("http://localhost/api/salary", {
        userId: coach.id,
        periodMonth: "2026-03",
        otherDeductions: 0,
        advanceDeduction: 0,
        paid: false,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.gross).toBe(30_000);
    expect(body.attendanceDeducted).toBe(0);
    expect(body.advanceDeducted).toBe(0);
    expect(body.netAmount).toBe(30_000);

    const row = await prisma.salaryPayment.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.centreId).toBe(centre.id);
    expect(row.userId).toBe(coach.id);
    expect(row.periodMonth).toBe("2026-03");
    expect(row.grossAmount).toBe(30_000);
    expect(row.netAmount).toBe(30_000);
    expect(row.paidAt).toBeNull(); // paid:false → no clearance timestamp
  });

  it("subtracts otherDeductions and uses grossOverride when supplied", async () => {
    const { accountant, coach } = await scaffold({ monthlySalary: 30_000 });
    await signInAs(accountant);

    const res = await postSalary(
      jsonReq("http://localhost/api/salary", {
        userId: coach.id,
        periodMonth: "2026-04",
        otherDeductions: 1_500, // PF / tax / misc
        advanceDeduction: 0,
        grossOverride: 40_000, // bonus month
        paid: true,
        method: "bank",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gross).toBe(40_000);
    expect(body.netAmount).toBe(40_000 - 1_500);

    const row = await prisma.salaryPayment.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.method).toBe("bank");
    expect(row.paidAt).not.toBeNull();
  });

  it("recovers an outstanding employee advance, oldest first", async () => {
    const { accountant, coach, centre } = await scaffold({ monthlySalary: 30_000 });
    // Two open advances — older one should be drawn down first.
    const advance1 = await prisma.employeeAdvance.create({
      data: {
        userId: coach.id,
        centreId: centre.id,
        amount: 5_000,
        reason: "Medical",
        givenAt: new Date("2026-01-10"),
        givenByUserId: accountant.id,
        status: "outstanding",
      },
    });
    const advance2 = await prisma.employeeAdvance.create({
      data: {
        userId: coach.id,
        centreId: centre.id,
        amount: 5_000,
        reason: "Travel",
        givenAt: new Date("2026-02-10"),
        givenByUserId: accountant.id,
        status: "outstanding",
      },
    });
    await signInAs(accountant);

    const res = await postSalary(
      jsonReq("http://localhost/api/salary", {
        userId: coach.id,
        periodMonth: "2026-05",
        otherDeductions: 0,
        advanceDeduction: 6_000, // recovers all of #1 + ₹1k of #2
        paid: false,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.advanceDeducted).toBe(6_000);
    expect(body.netAmount).toBe(30_000 - 6_000);

    // Advance 1 fully repaid; advance 2 partially.
    const a1 = await prisma.employeeAdvance.findUniqueOrThrow({ where: { id: advance1.id } });
    const a2 = await prisma.employeeAdvance.findUniqueOrThrow({ where: { id: advance2.id } });
    expect(a1.status).toBe("repaid");
    expect(a2.status).toBe("partially_repaid");

    // Repayment rows landed on the right advances.
    const r1 = await prisma.advanceRepayment.findMany({ where: { advanceId: advance1.id } });
    const r2 = await prisma.advanceRepayment.findMany({ where: { advanceId: advance2.id } });
    expect(r1.reduce((s, r) => s + r.amount, 0)).toBe(5_000);
    expect(r2.reduce((s, r) => s + r.amount, 0)).toBe(1_000);
  });

  it("refuses to re-record the same (user, periodMonth)", async () => {
    const { accountant, coach } = await scaffold();
    await signInAs(accountant);

    const first = await postSalary(
      jsonReq("http://localhost/api/salary", {
        userId: coach.id,
        periodMonth: "2026-06",
        otherDeductions: 0,
        advanceDeduction: 0,
        paid: false,
      }),
    );
    expect(first.status).toBe(200);

    const dup = await postSalary(
      jsonReq("http://localhost/api/salary", {
        userId: coach.id,
        periodMonth: "2026-06",
        otherDeductions: 0,
        advanceDeduction: 0,
        paid: false,
      }),
    );
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toBe("ALREADY_RECORDED");
  });

  it("returns NO_SALARY_STRUCTURE when the staff has no structure on file", async () => {
    const org = await mkOrg();
    const centre = await mkCentre({ orgId: org.id });
    const accountant = await mkUser({ role: "ACCOUNTANT", centreId: centre.id });
    const newHire = await mkUser({ role: "COACH", centreId: centre.id }); // no SalaryStructure
    await signInAs(accountant);

    const res = await postSalary(
      jsonReq("http://localhost/api/salary", {
        userId: newHire.id,
        periodMonth: "2026-07",
        otherDeductions: 0,
        advanceDeduction: 0,
        paid: false,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("NO_SALARY_STRUCTURE");
  });

  it("rejects a caller without payroll-manage permission", async () => {
    const { coach } = await scaffold();
    const org = await mkOrg();
    const otherCentre = await mkCentre({ orgId: org.id });
    const coachCaller = await mkUser({ role: "COACH", centreId: otherCentre.id });
    await signInAs(coachCaller);

    const res = await postSalary(
      jsonReq("http://localhost/api/salary", {
        userId: coach.id,
        periodMonth: "2026-08",
        otherDeductions: 0,
        advanceDeduction: 0,
        paid: false,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("FORBIDDEN");
  });

  it("prevents a centre-scoped accountant from recording salary in another centre", async () => {
    const { coach: foreignCoach } = await scaffold();
    const localOrg = await mkOrg();
    const localCentre = await mkCentre({ orgId: localOrg.id });
    const localAccountant = await mkUser({ role: "ACCOUNTANT", centreId: localCentre.id });
    await signInAs(localAccountant);

    const res = await postSalary(
      jsonReq("http://localhost/api/salary", {
        userId: foreignCoach.id, // different centre
        periodMonth: "2026-09",
        otherDeductions: 0,
        advanceDeduction: 0,
        paid: false,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("FORBIDDEN_CROSS_CENTRE");
  });
});
