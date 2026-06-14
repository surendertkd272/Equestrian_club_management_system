import { z } from "zod";

export const CHECKLIST_SCOPES = ["general", "per_horse"] as const;
export const CHECKLIST_STATUSES = ["done", "not_done", "na"] as const;

export const upsertItemSchema = z.object({
  label: z.string().min(2).max(200),
  section: z.string().max(80).nullable().optional(),
  orderIndex: z.coerce.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});

export const CHECKLIST_SHIFTS = ["morning", "evening"] as const;

// Coach submission — one entry per template item + optional general notes.
// horseId required for per_horse templates, ignored for general ones.
export const submitChecklistSchema = z.object({
  templateId: z.string().min(1),
  horseId: z.string().min(1).optional(),
  generalNotes: z.string().max(2000).optional(),
  shift: z.enum(CHECKLIST_SHIFTS).optional(),
  // The coach's truthful-submission declaration. Optional in the schema so
  // per-horse submissions (no declaration) keep working; the daily-coach form
  // requires the tick client-side.
  declarationAgreed: z.boolean().optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        status: z.enum(CHECKLIST_STATUSES),
        remarks: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(200),
});

// Stable-manager countersign on a filed submission.
export const reviewChecklistSchema = z.object({
  submissionId: z.string().min(1),
});

export type UpsertItemInput = z.infer<typeof upsertItemSchema>;
export type SubmitChecklistInput = z.infer<typeof submitChecklistSchema>;
