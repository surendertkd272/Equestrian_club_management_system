import { z } from "zod";

// Deworming is tracked separately from VaccinationSchedule because the
// cadence rotates between drugs (Ivermectin → Praziquantel → Panacur) and
// the vet wants free-text product naming, not an enum. Vaccination schedule
// has a "deworm_*" key set for back-compat — new entries should land here.

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required");

// Common rotation — surfaced in the UI as suggested products. The list is
// not enforced; the vet can type anything.
export const COMMON_DEWORMERS = [
  "Ivermectin Paste",
  "Praziquantel",
  "Panacur (Fenbendazole)",
  "Strongid (Pyrantel)",
  "Equimax (Ivermectin + Praziquantel)",
] as const;

export const createDewormingSchema = z.object({
  horseId: z.string().min(1),
  product: z.string().min(2).max(120),
  scheduledAt: ymd,
  notes: z.string().max(300).optional(),
});

export const markGivenSchema = z.object({
  givenAt: ymd.optional(), // defaults to today
  // Auto-schedule the next dose this many days out. Default 60 (typical
  // 8-week cadence for the rotation).
  nextIntervalDays: z.coerce.number().int().min(7).max(365).default(60),
  notes: z.string().max(300).optional(),
});

export type CreateDewormingInput = z.infer<typeof createDewormingSchema>;
