import { z } from "zod";
import { storedUrl } from "@/lib/schemas/url";

const dateLike = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createHqExpenseSchema = z.object({
  amount: z.coerce.number().min(0.01).max(1_000_000_000),
  gstAmount: z.coerce.number().min(0).max(100_000_000).default(0),
  spentAt: dateLike,
  description: z.string().min(2).max(300),
  vendorName: z.string().max(120).optional(),
  invoiceRef: z.string().max(60).optional(),
  categoryId: z.string().min(1).optional(),
  taggedCentreIds: z.array(z.string()).max(50).default([]),
  paid: z.boolean().default(false),
  paidAt: dateLike.optional(),
  method: z.enum(["cash", "bank", "cheque", "upi", "card"]).optional(),
  attachmentUrl: storedUrl,
});

export type CreateHqExpenseInput = z.infer<typeof createHqExpenseSchema>;
