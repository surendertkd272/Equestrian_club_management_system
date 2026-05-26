import { z } from "zod";

export const FARRIER_WORK_TYPES = [
  "trim",            // hoof trim only
  "hoofing",         // routine hoof care (client term — trim + shape + balance)
  "new_horse_shoe",  // brand-new shoes fitted
  "shoe_full",       // four shoes
  "shoe_partial",    // front-only or hind-only
  "reset",           // existing shoes refitted
  "other",
] as const;

export const FARRIER_STATUSES = ["scheduled", "completed", "skipped", "cancelled"] as const;

// Default interval between farrier visits — 6 weeks is the standard cadence
// for working horses. Per-club override can be added later if needed.
export const DEFAULT_FARRIER_INTERVAL_DAYS = 42;

const dt = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "YYYY-MM-DD or ISO datetime required");

export const createFarrierVisitSchema = z.object({
  horseId: z.string().min(1),
  farrierName: z.string().min(1).max(80),
  farrierUserId: z.string().nullable().optional(),
  scheduledAt: dt,
  workType: z.enum(FARRIER_WORK_TYPES),
  hoofNotes: z.string().max(500).optional(),
  cost: z.coerce.number().nonnegative().optional(),
});

export const completeFarrierVisitSchema = z.object({
  completedAt: dt.optional(),
  hoofNotes: z.string().max(500).optional(),
  cost: z.coerce.number().nonnegative().optional(),
  // Override next-due if the farrier wants a non-standard interval.
  nextDueAt: dt.optional(),
});

export type CreateFarrierVisitInput = z.infer<typeof createFarrierVisitSchema>;
export type CompleteFarrierVisitInput = z.infer<typeof completeFarrierVisitSchema>;
