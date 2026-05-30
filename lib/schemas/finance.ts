import { z } from "zod";

export const EXPENSE_GROUPS = [
  "operating",
  "salaries",
  "vet",
  "feed",
  "maintenance",
  "utilities",
  "tax",
  "other",
] as const;

export const createExpenseCategorySchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/),
  name: z.string().min(2).max(80),
  group: z.enum(EXPENSE_GROUPS).default("operating"),
});

export const createVendorSchema = z.object({
  name: z.string().min(2).max(120),
  // category drives the contact-database UX in /vendors; see
  // lib/schemas/vendor.ts VENDOR_CATEGORIES for the canonical list.
  category: z.string().max(40).optional(),
  // Delivery coverage — "centre" (local, own club only) or "national"
  // (all-India, visible to every club in the org). Default centre.
  deliveryScope: z.enum(["centre", "national"]).optional(),
  // Owning centre — HQ admins pick it from the form when on the all-centres
  // view; centre-scoped users ignore it (server uses their own centre).
  centreId: z.string().min(1).optional(),
  contactName: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  address: z.string().max(300).optional(),
  gstin: z.string().max(30).optional(),
  // Bank details — optional. Useful for vendors paid via NEFT/IMPS
  // (recurring contracts like feed suppliers + ambulance retainers).
  bankAccountName: z.string().max(120).optional(),
  bankAccountNumber: z.string().max(30).optional(),
  bankIfsc: z.string().max(11).optional(),
  bankName: z.string().max(80).optional(),
  notes: z.string().max(500).optional(),
  // Free-form JSON for category-specific fields (Vet Doctor / Farrier
  // registration extras). Persisted as a string blob in
  // Vendor.categorySpecificJson — see lib/schemas/vendor.ts for shape.
  categorySpecific: z.record(z.any()).optional(),
});

export const updateVendorSchema = createVendorSchema.partial().extend({
  active: z.boolean().optional(),
});

const dateLike = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createExpenseSchema = z.object({
  categoryId: z.string().min(1),
  vendorId: z.string().optional().nullable(),
  amount: z.coerce.number().min(0).max(100_000_000),
  gstAmount: z.coerce.number().min(0).max(10_000_000).default(0),
  spentAt: dateLike,
  description: z.string().min(2).max(300),
  invoiceRef: z.string().max(60).optional(),
  paid: z.boolean().default(false),
  paidAt: dateLike.optional(),
  method: z.enum(["cash", "bank", "cheque", "upi", "card"]).optional(),
  attachmentUrl: z.string().url().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();
