import { z } from "zod";

export const jumpEffortSchema = z.object({
  fenceNo: z.string().min(1).max(8),
  knockdown: z.boolean().default(false),
  refusal: z.coerce.number().int().min(0).max(3).default(0),
  eliminated: z.boolean().default(false),
  fall: z.boolean().default(false),
  notes: z.string().max(200).optional().nullable(),
});

export const recordJumpScoresSchema = z.object({
  roundId: z.string().min(1),
  entryId: z.string().min(1),
  efforts: z.array(jumpEffortSchema).min(1).max(40),
  timeSec: z.coerce.number().min(0).max(1200).optional().nullable(),
});
