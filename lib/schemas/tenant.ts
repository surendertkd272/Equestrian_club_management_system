import { z } from "zod";

// Statuses an owner can move a tenant between in Phase 3. Plan changes are
// gated to Phase 4 because they have to re-seed OrgFeature in a transaction.
export const TENANT_STATUSES = ["active", "trial", "past_due", "suspended"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

const emailOrEmpty = z
  .string()
  .max(200)
  .nullable()
  .optional()
  .refine((v) => v === undefined || v === null || v === "" || z.string().email().safeParse(v).success, {
    message: "must be a valid email or empty",
  });

// Fields the owner can patch on a tenant. Slug is intentionally excluded — it's
// the public identifier, baked into URLs and logs. Renaming a slug is an
// explicit migration, not a metadata edit.
export const updateTenantSchema = z
  .object({
    name: z.string().min(2).max(150).optional(),
    contactName: z.string().max(120).nullable().optional(),
    billingEmail: emailOrEmpty,
    phone: z.string().max(40).nullable().optional(),
    status: z.enum(TENANT_STATUSES).optional(),
  })
  .strict();

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
