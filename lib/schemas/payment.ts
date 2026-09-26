import { z } from "zod";

// Record a manual (non-Razorpay) payment against an invoice. The amount can
// be less than the invoice total — the invoice stays "due" until cumulative
// payments cover the full ask. method is the channel the cash actually
// arrived through (cash at the counter, bank transfer, UPI, cheque).
export const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().positive().max(10_000_000),
  method: z.enum(["cash", "cheque", "upi", "bank", "card"]),
  txnRef: z.string().max(60).optional(),
  // Optional override of the paid date (defaults to now). Useful when
  // back-entering a receipt from yesterday's till.
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/)
    .optional(),
  notes: z.string().max(300).optional(),
  // A family often pays more than the one invoice in front of the operator —
  // registration plus the first month in one UPI transfer. Without this the
  // extra could not be recorded at all ("must be ≤ 3000"). When set, anything
  // above what the invoice still owes is kept as an advance on the rider's
  // account (an invoice-less receipt) instead of over-paying the invoice.
  // Opt-in, so a typo — 30000 for 3000 — is still refused rather than quietly
  // turned into a ₹27,000 advance.
  excessAsAdvance: z.boolean().optional(),
});

export const bulkMarkPaidSchema = z.object({
  invoiceIds: z.array(z.string().min(1)).min(1).max(200),
  method: z.enum(["cash", "cheque", "upi", "bank", "card"]).default("cash"),
});
