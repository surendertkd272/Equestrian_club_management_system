import { z } from "zod";

export const requisitionItemSchema = z.object({
  // min(1) — single-letter names are real (e.g. "A", "B" for arena fences,
  // "X" for X-ray plates). The previous min(2) was rejecting valid input
  // and surfacing as a generic 400 because the client form filter only
  // checks for truthy strings.
  name: z.string().min(1).max(160),
  qty: z.coerce.number().positive().max(100_000),
  unit: z.string().max(40).optional(),
  estimatedUnitCost: z.coerce.number().min(0).max(10_000_000),
  notes: z.string().max(300).optional(),
});

export const createRequisitionSchema = z.object({
  items: z.array(requisitionItemSchema).min(1).max(50),
  reason: z.string().max(500).optional(),
  // SUPER_ADMIN posts this when their session has no centreId pinned.
  // Centre-scoped users have it ignored (the route prefers session.centreId).
  centreId: z.string().min(1).optional(),
});

export const decideRequisitionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().max(500).optional(),
});

export type RequisitionItemInput = z.infer<typeof requisitionItemSchema>;
export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;
export type DecideRequisitionInput = z.infer<typeof decideRequisitionSchema>;
