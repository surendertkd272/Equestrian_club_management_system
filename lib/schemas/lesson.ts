import { z } from "zod";

// One concrete session — either tied to a recurring Batch (the common
// case) or ad-hoc (clinic, make-up class). End time must be after the
// start; defaults follow the batch's startTime/endTime if not given by
// the caller.
export const createLessonSchema = z
  .object({
    batchId: z.string().min(1).optional().nullable(),
    centreId: z.string().min(1).optional(),
    date: z.string().min(1), // ISO datetime
    endAt: z.string().min(1),
    coachId: z.string().min(1).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  })
  .refine((d) => new Date(d.endAt) > new Date(d.date), {
    message: "endAt must be after date",
    path: ["endAt"],
  });

export const updateLessonSchema = z.object({
  date: z.string().min(1).optional(),
  endAt: z.string().min(1).optional(),
  coachId: z.string().min(1).optional().nullable(),
  status: z.enum(["scheduled", "completed", "cancelled", "rescheduled"]).optional(),
  notes: z.string().max(500).optional().nullable(),
  rescheduledToId: z.string().min(1).optional().nullable(),
});

// Per-lesson allocation. One row per rider→horse pairing for the session.
export const allocateLessonSchema = z.object({
  pairings: z
    .array(
      z.object({
        riderId: z.string().min(1),
        horseId: z.string().min(1),
        notes: z.string().max(200).optional().nullable(),
      }),
    )
    .min(1)
    .max(50),
});
