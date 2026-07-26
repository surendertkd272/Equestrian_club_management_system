import { z } from "zod";

// Coach's "daily 5-minute update" — a fast end-of-day note, one per coach
// per day. Distinct from the per-horse checklist: this is the narrative
// "what happened today + anything to flag" the client asked for.
export const coachUpdateSchema = z.object({
  // Same window as the attendance register. A coach files this from a phone
  // at the end of a long day; a fat-fingered year used to be accepted and
  // then sat permanently at the top of the list, sorted above every real
  // entry, with no way to edit or delete it.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required")
    .refine((v) => {
      const [y, m, d] = v.split("-").map(Number);
      const t = Date.UTC(y, m - 1, d, 12, 0, 0);
      if (Number.isNaN(t)) return false;
      const now = Date.now();
      return t >= now - 60 * 86_400_000 && t <= now + 2 * 86_400_000;
    }, "Date must be within the last 60 days — check the year"),
  summary: z.string().min(3).max(2000),
  horsesWorked: z.coerce.number().int().min(0).max(500).optional(),
  ridersTaught: z.coerce.number().int().min(0).max(500).optional(),
  injuriesNoted: z.string().max(1000).optional(),
  minutesSpent: z.coerce.number().int().min(0).max(1440).optional(),
});

export type CoachUpdateInput = z.infer<typeof coachUpdateSchema>;
