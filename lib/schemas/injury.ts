import { z } from "zod";

export const INJURY_SUBJECTS = ["horse", "rider"] as const;
export const INJURY_SEVERITIES = ["minor", "moderate", "severe"] as const;
export const INJURY_STATUSES = ["active", "recovering", "recovered", "chronic"] as const;

const dt = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "YYYY-MM-DD or ISO datetime");

export const createInjurySchema = z.object({
  subjectType: z.enum(INJURY_SUBJECTS),
  subjectId: z.string().min(1),
  occurredAt: dt,
  location: z.string().max(80).optional(),
  severity: z.enum(INJURY_SEVERITIES).default("minor"),
  cause: z.string().max(200).optional(),
  initialNotes: z.string().min(1).max(2000),
});

// Treatment entries are appended to the JSON list — the UI shows them as a
// timeline. Each entry is one care moment (dose, bandage change, vet visit).
export const addTreatmentSchema = z.object({
  at: z.string().datetime().optional(),
  treatment: z.string().min(1).max(400),
  notes: z.string().max(800).optional(),
});

export const updateInjuryStatusSchema = z.object({
  status: z.enum(INJURY_STATUSES),
  recoveredAt: dt.optional(),
});

export type CreateInjuryInput = z.infer<typeof createInjurySchema>;
export type AddTreatmentInput = z.infer<typeof addTreatmentSchema>;
