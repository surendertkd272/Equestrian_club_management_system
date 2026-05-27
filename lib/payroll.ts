// Server-side payroll helpers: resolve a staff member's effective salary for
// a month, count their attendance by status, load the global deduction rules,
// and assemble the full computed breakdown. Shared by the salary preview +
// record endpoints so both agree on the maths.

import { prisma } from "./prisma";
import {
  parseDeductionRules,
  monthBounds,
  computeAttendanceDeduction,
} from "./schemas/payroll";

// The salary in force for `periodMonth` = the structure row with the latest
// effectiveFrom on or before the END of that month. Returns 0 if none set.
export async function effectiveSalary(userId: string, periodMonth: string): Promise<number> {
  const { end } = monthBounds(periodMonth);
  const row = await prisma.salaryStructure.findFirst({
    where: { userId, effectiveFrom: { lt: end } },
    orderBy: { effectiveFrom: "desc" },
    select: { monthlySalary: true },
  });
  return row?.monthlySalary ?? 0;
}

// Resolve the org's global deduction rules for the centre the user belongs to.
export async function deductionRulesForCentre(centreId: string | null): Promise<Record<string, number>> {
  if (!centreId) return {};
  const centre = await prisma.centre.findUnique({ where: { id: centreId }, select: { orgId: true } });
  if (!centre) return {};
  const cfg = await prisma.payrollConfig.findUnique({ where: { orgId: centre.orgId } });
  return parseDeductionRules(cfg?.deductionRulesJson);
}

// Count a staff member's attendance by status across the month.
export async function attendanceCounts(userId: string, periodMonth: string): Promise<Record<string, number>> {
  const { start, end } = monthBounds(periodMonth);
  const rows = await prisma.staffAttendance.groupBy({
    by: ["status"],
    where: { userId, date: { gte: start, lt: end } },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}

// Outstanding advance balance for a user (sum of unpaid advance principal).
export async function outstandingAdvance(userId: string): Promise<number> {
  const advances = await prisma.employeeAdvance.findMany({
    where: { userId, status: { in: ["outstanding", "partially_repaid"] } },
    include: { repayments: { select: { amount: true } } },
  });
  return advances.reduce((sum, a) => {
    const repaid = a.repayments.reduce((s, r) => s + r.amount, 0);
    return sum + Math.max(0, a.amount - repaid);
  }, 0);
}

// Full computed picture for one staff member + month, before the admin
// chooses other-deductions / advance recovery.
export async function salaryPreview(userId: string, centreId: string | null, periodMonth: string) {
  const [gross, rules, counts, advanceOutstanding] = await Promise.all([
    effectiveSalary(userId, periodMonth),
    deductionRulesForCentre(centreId),
    attendanceCounts(userId, periodMonth),
    outstandingAdvance(userId),
  ]);
  const { total: attendanceDeducted, breakdown } = computeAttendanceDeduction(counts, rules);
  return {
    gross,
    attendanceDeducted,
    absentDays: counts["absent"] ?? 0,
    breakdown,
    advanceOutstanding,
    counts,
  };
}
