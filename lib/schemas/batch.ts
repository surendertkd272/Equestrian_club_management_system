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

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
