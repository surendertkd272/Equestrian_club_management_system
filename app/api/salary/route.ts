// Record a staff member's monthly salary settlement.
//   gross               = salary structure in force for the month (or override)
//   attendanceDeducted  = Σ status-days × global per-status rate (PayrollConfig)
//   advanceDeducted     = auto-recovered from outstanding advances, oldest-first
//   net = gross − otherDeductions − attendanceDeducted − advanceDeducted
// One SalaryPayment per (user, month); re-posting the same month is rejected.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { recordSalarySchema } from "@/lib/schemas/payroll";
import { effectiveSalary, attendanceCounts, deductionRulesForCentre } from "@/lib/payroll";
import { computeAbsenceDeduction } from "@/lib/schemas/payroll";

function canManagePayroll(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManagePayroll(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = recordSalarySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const staffUser = await prisma.user.findUnique({
    where: { id: d.userId },
    select: { id: true, centreId: true, name: true, status: true },
  });
  if (!staffUser || !staffUser.centreId) {
    return NextResponse.json({ error: "STAFF_NOT_FOUND" }, { status: 404 });
  }
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== staffUser.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Don't pay someone who has left. There was no employment-status check at
  // all, so a resigned or terminated employee could be run through payroll
  // indefinitely — and nothing here is reversible once recorded. HQ can still
  // force it for a genuine final settlement by passing an explicit gross.
  if (staffUser.status !== "active" && d.grossOverride === undefined) {
    return NextResponse.json(
      {
        error: "STAFF_NOT_ACTIVE",
        status: staffUser.status,
        message: `${staffUser.name} is ${staffUser.status}. To record a final settlement, enter the amount explicitly.`,
      },
      { status: 409 },
    );
  }

  // Don't pay a month that hasn't happened. The period was regex-checked for
  // shape but not for reality, so payroll could be run for 2027-12 today —
  // overstating cost, consuming the advance balance, and (being irreversible)
  // needing a DB edit to undo.
  const nowMonth = new Date().toISOString().slice(0, 7);
  if (d.periodMonth > nowMonth) {
    return NextResponse.json(
      {
        error: "PERIOD_IN_FUTURE",
        message: `Payroll can't be run for ${d.periodMonth} — that month hasn't started yet.`,
      },
      { status: 400 },
    );
  }

  // Only a LIVE run blocks the month; a voided one was a correction.
  const dup = await prisma.salaryPayment.findFirst({
    where: { userId: d.userId, periodMonth: d.periodMonth, voidedAt: null },
  });
  if (dup) return NextResponse.json({ error: "ALREADY_RECORDED", month: d.periodMonth }, { status: 409 });

  // Gross from the salary structure (or an explicit override for bonus months).
  const gross = d.grossOverride ?? (await effectiveSalary(d.userId, d.periodMonth));
  if (gross <= 0) {
    return NextResponse.json({ error: "NO_SALARY_STRUCTURE" }, { status: 400 });
  }

  // Absence-based deduction: (base / 30) per absent day (half for half-days).
  const counts = await attendanceCounts(d.userId, d.periodMonth);
  // Apply the org's configured per-status rates. Without this the policy screen
  // was decorative: it saved, echoed back, and payroll used a derived rate.
  const deductionRules = await deductionRulesForCentre(staffUser.centreId);
  const { total: rawAttendanceDeducted, breakdown: rawBreakdown } = computeAbsenceDeduction(gross, counts, deductionRules);
  // A deduction can never exceed the salary it is deducted from. netAmount was
  // already clamped at 0, but attendanceDeducted was stored uncapped — so the
  // row failed its own invariant (gross - deductions != net) and the Tally
  // salary voucher built from it did not balance, which makes Tally reject the
  // whole import batch. Scale the breakdown with it so the payslip still
  // explains the figure actually applied.
  const attendanceDeducted = Math.min(rawAttendanceDeducted, gross);
  const scale = rawAttendanceDeducted > 0 ? attendanceDeducted / rawAttendanceDeducted : 1;
  const breakdown = scale === 1 ? rawBreakdown : rawBreakdown.map((b) => ({ ...b, amount: b.amount * scale }));
  const absentDays = counts["absent"] ?? 0;

  // Guard: "other deductions" can't exceed what's left after the attendance cut
  // — otherwise net pay would go negative. (Advance recovery is capped below.)
  const maxOtherDeductions = Math.max(0, gross - attendanceDeducted);
  if (d.otherDeductions > maxOtherDeductions + 0.01) {
    return NextResponse.json(
      {
        error: "OTHER_DEDUCTIONS_EXCEED_NET",
        message: `Other deductions (₹${Math.round(d.otherDeductions).toLocaleString("en-IN")}) can't exceed the ₹${Math.round(maxOtherDeductions).toLocaleString("en-IN")} left after the attendance deduction.`,
        max: maxOtherDeductions,
      },
      { status: 400 },
    );
  }

  // Open advances, oldest first — we recover from these in order.
  const openAdvances = await prisma.employeeAdvance.findMany({
    where: { userId: d.userId, status: { in: ["outstanding", "partially_repaid"] } },
    include: { repayments: { select: { amount: true } } },
    orderBy: { givenAt: "asc" },
  });
  const totalOutstanding = openAdvances.reduce((sum, a) => {
    const repaid = a.repayments.reduce((s, r) => s + r.amount, 0);
    return sum + Math.max(0, a.amount - repaid);
  }, 0);

  // Cap advance recovery: can't exceed outstanding, can't drive net negative.
  const takeHomeBeforeAdvance = Math.max(0, gross - d.otherDeductions - attendanceDeducted);
  const advanceDeducted = Math.min(d.advanceDeduction, totalOutstanding, takeHomeBeforeAdvance);
  const netAmount = Math.max(0, gross - d.otherDeductions - attendanceDeducted - advanceDeducted);

  const result = await prisma.$transaction(async (tx) => {
    // Track what this run recovers so it can be linked to the payroll row
    // below — voiding the run then releases exactly these amounts.
    const repaymentIds: string[] = [];
    let remaining = advanceDeducted;
    for (const adv of openAdvances) {
      if (remaining <= 0.01) break;
      const repaid = adv.repayments.reduce((s, r) => s + r.amount, 0);
      const advRemaining = Math.max(0, adv.amount - repaid);
      if (advRemaining <= 0.01) continue;
      const take = Math.min(advRemaining, remaining);
      const rep = await tx.advanceRepayment.create({
        data: {
          advanceId: adv.id,
          amount: take,
          recordedByUserId: session.userId,
          notes: `Auto-deducted from ${d.periodMonth} salary`,
        },
      });
      repaymentIds.push(rep.id);
      const newStatus = repaid + take >= adv.amount - 0.01 ? "repaid" : "partially_repaid";
      await tx.employeeAdvance.update({ where: { id: adv.id }, data: { status: newStatus } });
      remaining -= take;
    }

    const created = await tx.salaryPayment.create({
      data: {
        centreId: staffUser.centreId!,
        userId: d.userId,
        periodMonth: d.periodMonth,
        grossAmount: gross,
        attendanceDeducted,
        absentDays,
        // jsonb column — pass the array directly; empty → Prisma.DbNull.
        deductionBreakdownJson: breakdown.length > 0 ? breakdown : Prisma.DbNull,
        advanceDeducted,
        otherDeductions: d.otherDeductions,
        netAmount,
        method: d.method ?? null,
        paidAt: d.paid ? new Date() : null,
        notes: d.notes ?? null,
        recordedByUserId: session.userId,
      },
    });
    if (repaymentIds.length > 0) {
      await tx.advanceRepayment.updateMany({
        where: { id: { in: repaymentIds } },
        data: { salaryPaymentId: created.id },
      });
    }
    return created;
  });

  await audit({
    userId: session.userId,
    action: "salary.record",
    tableName: "salaryPayment",
    rowId: result.id,
    after: {
      userId: d.userId,
      periodMonth: d.periodMonth,
      gross,
      attendanceDeducted,
      absentDays,
      advanceDeducted,
      net: netAmount,
    },
  });

  await notify({
    userId: d.userId,
    centreId: staffUser.centreId,
    type: "salary.recorded",
    title: `${d.periodMonth} salary recorded — net ₹${Math.round(netAmount).toLocaleString("en-IN")}`,
    body: [
      attendanceDeducted > 0 ? `₹${Math.round(attendanceDeducted).toLocaleString("en-IN")} attendance deduction (${absentDays} absent)` : null,
      advanceDeducted > 0 ? `₹${Math.round(advanceDeducted).toLocaleString("en-IN")} advance recovered` : null,
    ].filter(Boolean).join(" · ") || "No deductions.",
    link: "/account",
  });

  return NextResponse.json({ ok: true, id: result.id, gross, attendanceDeducted, advanceDeducted, netAmount });
}
