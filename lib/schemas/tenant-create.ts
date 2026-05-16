import { z } from "zod";
import { PLANS } from "@/lib/plans";

// Slug rules — same as Centre.slug today. Org slug shares the namespace at the
// validation layer but is unique within Organisation; centre slug is globally
// unique across the platform (used in public onboarding URLs).
const slugSchema = z
  .string()
  .min(2)
  .max(30)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, "lowercase letters, digits and hyphens only; must start with a letter");

// Three-step onboarding payload. The wizard collects each section sequentially
// in the UI but POSTs the whole thing at once so the back-end can run the
// provisioning transaction.
export const createTenantSchema = z.object({
  // Step 1 — tenant
  name: z.string().min(2).max(150),
  slug: slugSchema,
  plan: z.enum(PLANS),
  contactName: z.string().max(120).optional(),
  billingEmail: z.string().email().max(200).optional().or(z.literal("")),
  phone: z.string().max(40).optional(),

  // Step 2 — first centre
  centre: z.object({
    name: z.string().min(2).max(150),
    slug: slugSchema,
    address: z.string().max(300).optional(),
  }),

  // Step 3 — first super admin
  superAdmin: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(200),
    phone: z.string().max(40).optional(),
  }),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
