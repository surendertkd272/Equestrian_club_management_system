import { z } from "zod";

// Slug rules: lowercase alpha + digits + hyphens, must start with a letter,
// 2..30 chars. We surface this prominently in the UI because slugs are baked
// into onboarding URLs — choose carefully.
const slugSchema = z
  .string()
  .min(2)
  .max(30)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, "lowercase letters, digits and hyphens only; must start with a letter");

const gstSchema = z
  .string()
  .max(30)
  .nullable()
  .optional()
  .refine((v) => v === undefined || v === null || v === "" || /^[0-9A-Z]{15}$/.test(v), {
    message: "GST number must be 15 chars (digits + uppercase letters)",
  });

// Create a brand-new club. Slug is required and must be globally unique — the
// route enforces uniqueness with a friendly error rather than a raw DB error.
export const createCentreSchema = z.object({
  name: z.string().min(2).max(150),
  slug: slugSchema,
  address: z.string().max(300).nullable().optional(),
  gstNo: gstSchema,
});

// Emergency Contact Board — PDF §3. Each row is one phone-and-label pair.
// We don't try to parse the number: clubs in different cities/countries
// have different formats; the manager pastes whatever the vet wrote on the
// laminated sheet by the stable door.
export const emergencyContactSchema = z.object({
  label: z.string().min(1).max(80),
  number: z.string().min(3).max(40),
  type: z.enum(["vet", "ambulance", "police", "fire", "manager", "other"]).default("other"),
});

export const emergencyContactsSchema = z.array(emergencyContactSchema).max(20);
export type EmergencyContact = z.infer<typeof emergencyContactSchema>;

// Editable fields on a Centre. Slug is intentionally NOT editable here: it's
// the public onboarding URL and changing it would silently break links printed
// on flyers / shared in WhatsApp groups. If you ever need to rename a slug,
// take the explicit "create new + redirect old" path.
export const updateCentreSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  address: z.string().max(300).nullable().optional(),
  gstNo: gstSchema,
  emergencyContacts: emergencyContactsSchema.optional(),
});

export type CreateCentreInput = z.infer<typeof createCentreSchema>;
export type UpdateCentreInput = z.infer<typeof updateCentreSchema>;
