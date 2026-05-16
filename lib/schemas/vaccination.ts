import { z } from "zod";

// PDF §4 — Horse health schedules. Started as vaccine-only; widened to
// cover routine preventive care (deworming, dental floats, hoof trim
// reminders) so the same nextDueAt sweep + UI surfaces every recurring
// vet/farrier action. The discriminator field is still called
// `vaccineKey` for back-compat with the DB column + existing rows.
export const VACCINE_KEYS = [
  // Vaccines
  "tetanus",
  "ehv",
  "influenza",
  "rabies",
  "rhinopneumonitis",
  // Deworming protocols (rotate compounds to prevent resistance)
  "deworm_ivermectin",
  "deworm_strongid",
  "deworm_panacur",
  // Equine dental — typically 6–12 month float
  "dental_float",
  "dental_check",
  "custom",
] as const;

export const DEFAULT_INTERVAL_DAYS: Record<(typeof VACCINE_KEYS)[number], number> = {
  tetanus: 365,
  ehv: 180,
  influenza: 180,
  rabies: 365,
  rhinopneumonitis: 180,
  deworm_ivermectin: 90,
  deworm_strongid: 60,
  deworm_panacur: 180,
  dental_float: 365,
  dental_check: 180,
  custom: 365,
};

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required");

export const upsertScheduleSchema = z.object({
  horseId: z.string().min(1),
  vaccineKey: z.enum(VACCINE_KEYS),
  vaccineLabel: z.string().min(1).max(80),
  intervalDays: z.coerce.number().int().min(7).max(2000).optional(),
  // Next-due is either provided directly, or computed from firstDueAt /
  // lastGivenAt + intervalDays at insert time.
  nextDueAt: ymd.optional(),
  firstDueAt: ymd.optional(),
  lastGivenAt: ymd.optional(),
  notes: z.string().max(300).optional(),
});

// When recording a dose, we re-stamp lastGivenAt and recompute nextDueAt.
export const recordDoseSchema = z.object({
  givenAt: ymd.optional(), // defaults to today
  notes: z.string().max(300).optional(),
});

export type UpsertScheduleInput = z.infer<typeof upsertScheduleSchema>;
