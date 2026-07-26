import { z } from "zod";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(,(Mon|Tue|Wed|Thu|Fri|Sat|Sun))*$/;

export const createBatchSchema = z.object({
  name: z.string().min(2).max(80),
  dayOfWeek: z.string().regex(DAYS, "Use comma-separated day codes, e.g. Mon,Wed,Fri"),
  startTime: z.string().regex(TIME, "24-hour HH:MM"),
  endTime: z.string().regex(TIME, "24-hour HH:MM"),
  level: z.string().optional(),
  coachId: z.string().optional().or(z.literal("")),
});

// Editing a live batch. Every field optional so a caller can nudge one thing
// (a time change, a new coach) without restating the rest. There was no update
// route at all — PATCH/PUT/POST on a batch all returned 405, so a class whose
// time moved or whose coach changed could not be corrected, and once it had
// riders it could not be deleted either. A batch was effectively immortal and
// frozen from the moment it was created.
export const updateBatchSchema = z
  .object({
    name: z.string().min(2).max(80).optional(),
    dayOfWeek: z.string().regex(DAYS, "Use comma-separated day codes, e.g. Mon,Wed,Fri").optional(),
    startTime: z.string().regex(TIME, "24-hour HH:MM").optional(),
    endTime: z.string().regex(TIME, "24-hour HH:MM").optional(),
    level: z.string().max(60).optional().nullable(),
    coachId: z.string().min(1).optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });

export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
