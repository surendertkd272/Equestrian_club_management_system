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
import { sweepOnboardingDocsOverdue } from "./onboarding-docs-overdue";
import { sweepOnboardingLinkPurge } from "./onboarding-link-purge";
import { sweepTaskEscalation } from "./task-escalation";
import { sweepRecurringTasks } from "./recurring-tasks";
import { sweepRateLimitPurge } from "./rate-limit-purge";
import { sweepSessionRevocationPurge } from "./session-revocation-purge";
import { sweepSaasBillingRun } from "./saas-billing-run";

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
  sweepOnboardingDocsOverdue,
  sweepOnboardingLinkPurge,
  sweepTaskEscalation,
  sweepRecurringTasks,
  sweepRateLimitPurge,
  sweepSessionRevocationPurge,
  sweepSaasBillingRun,
};

// ─────────────────────────────────────────────────────────────────────────────
// Run all jobs (used by the /api/cron/sweep endpoint). Iterates the SWEEP_JOBS
// registry (single source of truth — defined below) under Promise.allSettled so
// ONE failing job no longer aborts the whole nightly batch. Previously this was
// Promise.all([...]): a single rejection rejected the entire run, silently
// skipping every job after it (dunning, DPDPA deletions, trial-end…). Now a
// thrown job becomes an error SweepResult and the rest still run.
export async function runAllSweeps(): Promise<SweepResult[]> {
  const entries = Object.entries(SWEEP_JOBS);
  const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));
  return settled.map((r, i) => {
    const job = entries[i][0];
    if (r.status === "fulfilled") return r.value;
    const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
    console.error(`[sweep] job "${job}" failed:`, r.reason);
    return { job, scanned: 0, notified: 0, skipped: 0, error };
  });
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
  onboarding_docs_overdue: () => sweepOnboardingDocsOverdue(),
  onboarding_link_purge: () => sweepOnboardingLinkPurge(),
  task_escalation: () => sweepTaskEscalation(),
  recurring_tasks: () => sweepRecurringTasks(),
  rate_limit_purge: () => sweepRateLimitPurge(),
  session_revocation_purge: () => sweepSessionRevocationPurge(),
  saas_billing_run: (opts?: SweepOpts) => sweepSaasBillingRun(opts),
};
