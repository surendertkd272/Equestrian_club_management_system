import { z } from "zod";

// Rider-initiated batch shift request. Two flavours behind one schema:
//
//   single_day  → 'I want to attend this batch THIS DATE only.' shiftDate
//                 required. Approver is any coach on the target batch.
//   permanent   → 'I want to switch to this batch from now on.'
//                 effectiveFrom optional (defaults to approval timestamp
//                 on the API side). Approver is centre manager only.

export const createBatchShiftSchema = z.object({
  kind: z.enum(["single_day", "permanent"]),
  toBatchId: z.string().min(1),
  // YYYY-MM-DD; required for single_day, ignored for permanent.
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // YYYY-MM-DD; optional for permanent.
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().max(500).optional(),
}).refine((d) => d.kind !== "single_day" || !!d.shiftDate, {
  message: "Single-day shifts need a shift date.",
  path: ["shiftDate"],
});

export const decideBatchShiftSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional(),
});

export type CreateBatchShiftInput = z.infer<typeof createBatchShiftSchema>;
export type DecideBatchShiftInput = z.infer<typeof decideBatchShiftSchema>;
