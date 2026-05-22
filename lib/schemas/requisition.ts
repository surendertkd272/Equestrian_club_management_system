import { z } from "zod";

export const requisitionItemSchema = z.object({
  name: z.string().min(2).max(160),
  qty: z.coerce.number().positive().max(100_000),
  unit: z.string().max(40).optional(),
  estimatedUnitCost: z.coerce.number().min(0).max(10_000_000),
  notes: z.string().max(300).optional(),
});

export const createRequisitionSchema = z.object({
  items: z.array(requisitionItemSchema).min(1).max(50),
  reason: z.string().max(500).optional(),
});

export const decideRequisitionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().max(500).optional(),
});

export type RequisitionItemInput = z.infer<typeof requisitionItemSchema>;
export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;
export type DecideRequisitionInput = z.infer<typeof decideRequisitionSchema>;
