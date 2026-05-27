import { z } from "zod";

// A month's salary settlement. The gross is what's owed; any outstanding
// employee advances are netted off automatically (capped so we never deduct
// more than the gross or more than the advance balance). net = gross −
// advanceDeducted − otherDeductions.
export const recordSalarySchema = z.object({
  userId: z.string().min(1),
  periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM required"),
  grossAmount: z.coerce.number().min(0).max(100_000_000),
  otherDeductions: z.coerce.number().min(0).max(100_000_000).default(0),
  // How much of the outstanding advance balance to recover this month. The
  // server caps it to min(requested, outstanding, gross − otherDeductions).
  advanceDeduction: z.coerce.number().min(0).max(100_000_000).default(0),
  method: z.enum(["cash", "bank", "upi", "cheque"]).optional(),
  paid: z.boolean().default(false),
  notes: z.string().max(300).optional(),
});

export type RecordSalaryInput = z.infer<typeof recordSalarySchema>;
