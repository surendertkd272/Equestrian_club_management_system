import { z } from "zod";

// Coach's "daily 5-minute update" — a fast end-of-day note, one per coach
// per day. Distinct from the per-horse checklist: this is the narrative
// "what happened today + anything to flag" the client asked for.
export const coachUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required"),
  summary: z.string().min(3).max(2000),
  horsesWorked: z.coerce.number().int().min(0).max(500).optional(),
  ridersTaught: z.coerce.number().int().min(0).max(500).optional(),
  injuriesNoted: z.string().max(1000).optional(),
  minutesSpent: z.coerce.number().int().min(0).max(1440).optional(),
});

export type CoachUpdateInput = z.infer<typeof coachUpdateSchema>;
