import { z } from "zod";

// Staff-attendance statuses that a deduction rule can be set for. "present"
// never deducts, so it's not configurable. half_day is included so the
// global config can drive a half-day cut once it's marked on attendance.
export const DEDUCTIBLE_STATUSES = ["absent", "late", "leave", "half_day"] as const;
export type DeductibleStatus = (typeof DEDUCTIBLE_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  absent: "Absent",
  late: "Late",
  leave: "Leave",
  half_day: "Half day",
};

// Global payroll config — Super Admin sets ₹/day deducted per status. The
// map is open-ended (dynamic); we validate each value is a non-negative
// number. Missing status = no deduction.
export const payrollConfigSchema = z.object({
  deductionRules: z.record(z.coerce.number().min(0).max(1_000_000)),
});

// Set or raise a staff member's salary. A raise is just a new effective-dated
// row; we never edit history in place.
export const salaryStructureSchema = z.object({
  userId: z.string().min(1),
  monthlySalary: z.coerce.number().min(0).max(100_000_000),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required"),
  note: z.string().max(200).optional(),
});

// Record a salary payment. Gross + attendance deduction are computed
// server-side from the structure + config + attendance; the client only
// chooses the month, optional other-deductions, and how much advance to recover.
export const recordSalarySchema = z.object({
  userId: z.string().min(1),
  periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM required"),
  otherDeductions: z.coerce.number().min(0).max(100_000_000).default(0),
  advanceDeduction: z.coerce.number().min(0).max(100_000_000).default(0),
  // Override the auto-resolved gross only if explicitly needed (e.g. a bonus
  // month). Normally omitted so the salary structure drives it.
  grossOverride: z.coerce.number().min(0).max(100_000_000).optional(),
  method: z.enum(["cash", "bank", "upi", "cheque"]).optional(),
  paid: z.boolean().default(false),
  notes: z.string().max(300).optional(),
});

export type SalaryStructureInput = z.infer<typeof salaryStructureSchema>;
export type RecordSalaryInput = z.infer<typeof recordSalarySchema>;

// Parse the stored deduction-rules JSON into a clean {status: amount} map.
// Accepts either a string (legacy / tests) or a parsed JsonValue (native jsonb).
export function parseDeductionRules(json: unknown): Record<string, number> {
  if (json === null || json === undefined || json === "") return {};
  try {
    const obj = typeof json === "string" ? JSON.parse(json) : json;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

// First + last instant of a "YYYY-MM" month (UTC), for attendance counting.
export function monthBounds(periodMonth: string): { start: Date; end: Date } {
  const [y, m] = periodMonth.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0)); // exclusive
  return { start, end };
}

// Payroll rule: one absent day deducts (monthly base / 30); a half-day deducts
// half of that. Late and leave don't deduct. Fixed 30-day divisor per spec.
export const PAYROLL_DAYS = 30;
export function dailyRate(gross: number): number {
  return gross > 0 ? gross / PAYROLL_DAYS : 0;
}

// Attendance deduction from absences, with a payslip breakdown. Derived from the
// staff member's base salary (not a configurable per-status rate).
export function computeAbsenceDeduction(
  gross: number,
  counts: Record<string, number>,
  // Per-status daily rates from the org's PayrollConfig, in rupees. When a
  // status has a configured rate it wins; anything unconfigured falls back to
  // the derived rate below, so an org that never set a policy sees exactly the
  // previous behaviour.
  //
  // This parameter is why the config existed. The policy screen saved rules and
  // echoed them back, deductionRulesForCentre() read them correctly — and
  // nothing ever called it, so payroll silently used the derived rate no matter
  // what the org had configured. An admin could set ₹800/day for absence and
  // watch payroll deduct something else entirely.
  rules: Record<string, number> = {},
): { total: number; breakdown: { status: string; days: number; rate: number; amount: number }[] } {
  const derived = dailyRate(gross);
  const breakdown: { status: string; days: number; rate: number; amount: number }[] = [];
  let total = 0;

  // Every status the org has priced, plus the two the derived formula has
  // always handled — so a configured "leave_unpaid" rate is honoured too.
  const statuses = new Set([...Object.keys(rules), "absent", "half_day"]);
  for (const status of statuses) {
    const days = counts[status] ?? 0;
    if (days <= 0) continue;
    const configured = rules[status];
    const rate =
      typeof configured === "number" && Number.isFinite(configured)
        ? configured
        : status === "absent"
          ? derived
          : status === "half_day"
            ? derived / 2
            : 0;
    if (rate <= 0) continue;
    const amount = days * rate;
    breakdown.push({ status, days, rate, amount });
    total += amount;
  }
  // Stable order so a payslip doesn't reshuffle between renders.
  breakdown.sort((a, b) => a.status.localeCompare(b.status));
  return { total, breakdown };
}
