import { z } from "zod";

// Staff-side invoice submission. Tighter than createExpenseSchema:
// invoice file is mandatory, `paid` is always false (accountant marks it
// paid later), and `categoryId` is optional — the submitter may not know
// the chart-of-accounts mapping.
const dateLike = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const submitExpenseSchema = z.object({
  amount: z.coerce.number().min(0.01).max(100_000_000),
  gstAmount: z.coerce.number().min(0).max(10_000_000).default(0),
  spentAt: dateLike,
  description: z.string().min(2).max(300),
  vendorName: z.string().max(120).optional(),
  invoiceRef: z.string().max(60).optional(),
  categoryId: z.string().min(1).optional(),
  attachmentUrl: z.string().url(),
});

export type SubmitExpenseInput = z.infer<typeof submitExpenseSchema>;
