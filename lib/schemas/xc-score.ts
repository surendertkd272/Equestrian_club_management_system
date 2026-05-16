import { z } from "zod";

// XC per-fence effort. Same shape as JumpEffort except the math interprets
// refusals differently (20 + 40 for 1st/2nd at same fence vs 4 each in SJ).
export const xcEffortSchema = z.object({
  fenceNo: z.string().min(1).max(8),
  refusal: z.coerce.number().int().min(0).max(3).default(0),
  eliminated: z.boolean().default(false),
  fall: z.boolean().default(false),
  notes: z.string().max(200).optional().nullable(),
});

export const recordXcScoresSchema = z.object({
  roundId: z.string().min(1),
  entryId: z.string().min(1),
  efforts: z.array(xcEffortSchema).max(60),
  timeSec: z.coerce.number().min(0).max(7200).optional().nullable(),
});
