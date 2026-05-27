import { z } from "zod";

export const createAdvanceSchema = z.object({
  userId: z.string().min(1),
  amount: z.coerce.number().positive().max(10_000_000),
  reason: z.string().min(2).max(200),
  notes: z.string().max(500).optional(),
});

export const recordRepaymentSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000),
  notes: z.string().max(200).optional(),
});

export type CreateAdvanceInput = z.infer<typeof createAdvanceSchema>;
export type RecordRepaymentInput = z.infer<typeof recordRepaymentSchema>;
