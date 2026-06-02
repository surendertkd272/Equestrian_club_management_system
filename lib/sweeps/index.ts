// Public API of the lib/sweeps module. Re-exports the bits the
// rest of the codebase imports (the cron route, monthly-dispatch,
// and the two tests in tests/api/) so the path `@/lib/sweeps` keeps
// working unchanged after the per-job file split.

// Re-export the types so `import type { SweepResult } from "@/lib/sweeps"`
// keeps working. Also imported below for use in the local
// runAllSweeps + SWEEP_JOBS definitions.
export type { SweepResult, SweepOpts } from "./shared";
import type { SweepResult, SweepOpts } from "./shared";

import { sweepFeeDue } from "./fee-due";
import { sweepMedicineExpiry } from "./medicine-expiry";
import { sweepHorseInsuranceExpiry } from "./horse-insurance-expiry";
import { sweepFarrierDigest } from "./farrier-digest";
import { sweepVaccinationDue } from "./vaccination-due";
import { sweepAbsenceEscalation } from "./absence-escalation";
import { sweepBirthdays } from "./birthdays";
import { sweepMonthlyReports } from "./monthly-reports";
import { sweepTenantOffboarding } from "./tenant-offboarding";
import { sweepDunning } from "./dunning";
import { sweepDpdpaDeletions } from "./dpdpa-deletions";
import { sweepAuditRetention } from "./audit-retention";
import { sweepTrialEnd } from "./trial-end";
import { sweepEquipmentLowStock } from "./equipment-low-stock";
import { sweepAccreditationExpiry } from "./accreditation-expiry";
import { sweepBinPurge } from "./bin-purge";
import { sweepCoachUpdateReminder } from "./coach-update-reminder";

export {
  sweepFeeDue,
  sweepMedicineExpiry,
  sweepHorseInsuranceExpiry,
  sweepFarrierDigest,
  sweepVaccinationDue,
  sweepAbsenceEscalation,
  sweepBirthdays,
  sweepMonthlyReports,
  sweepTenantOffboarding,
  sweepDunning,
  sweepDpdpaDeletions,
  sweepAuditRetention,
  sweepTrialEnd,
  sweepEquipmentLowStock,
  sweepAccreditationExpiry,
  sweepBinPurge,
  sweepCoachUpdateReminder,
};

// ─────────────────────────────────────────────────────────────────────────────
// Run all jobs (used by the /api/cron/sweep endpoint).
export async function runAllSweeps(): Promise<SweepResult[]> {
  return Promise.all([
    sweepFeeDue(),
    sweepMedicineExpiry(),
    sweepHorseInsuranceExpiry(),
    sweepFarrierDigest(),
    sweepVaccinationDue(),
    sweepAbsenceEscalation(),
    sweepBirthdays(),
    sweepMonthlyReports(),
    sweepTrialEnd(),
    sweepAuditRetention(),
    sweepDpdpaDeletions(),
    sweepDunning(),
    sweepTenantOffboarding(),
    sweepBinPurge(),
    sweepCoachUpdateReminder(),
  ]);
}

export const SWEEP_JOBS: Record<string, (opts?: SweepOpts) => Promise<SweepResult>> = {
  fee_due: () => sweepFeeDue(),
  medicine_expiry: () => sweepMedicineExpiry(),
  horse_insurance_expiry: () => sweepHorseInsuranceExpiry(),
  farrier_digest: () => sweepFarrierDigest(),
  vaccination_due: () => sweepVaccinationDue(),
  absence_escalation: () => sweepAbsenceEscalation(),
  birthdays: () => sweepBirthdays(),
  monthly_reports: (opts?: SweepOpts) => sweepMonthlyReports(opts),
  trial_end: () => sweepTrialEnd(),
  equipment_low_stock: () => sweepEquipmentLowStock(),
  accreditation_expiry: () => sweepAccreditationExpiry(),
  audit_retention: () => sweepAuditRetention(),
  dpdpa_deletions: () => sweepDpdpaDeletions(),
  dunning: () => sweepDunning(),
  tenant_offboarding: () => sweepTenantOffboarding(),
  bin_purge: () => sweepBinPurge(),
  coach_update_reminder: () => sweepCoachUpdateReminder(),
};
