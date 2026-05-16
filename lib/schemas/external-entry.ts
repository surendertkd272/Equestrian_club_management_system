import { z } from "zod";

// Public-form schema. We're more permissive than the internal-rider
// schema because external entrants don't have onboarding to step through
// — they fill one form and we trust + verify by email.
export const externalEntrySchema = z.object({
  className: z.string().min(1).max(80),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  mobile: z.string().min(7).max(20),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  parentName: z.string().max(120).optional().or(z.literal("")),
  parentRelation: z.enum(["father", "mother", "guardian"]).optional(),
  parentPhone: z.string().max(20).optional().or(z.literal("")),
  parentConsentAgreed: z.boolean().optional(),
  accreditationBody: z.string().max(40).optional().or(z.literal("")),
  accreditationNumber: z.string().max(60).optional().or(z.literal("")),
  accreditationExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  horseName: z.string().max(80).optional().or(z.literal("")),
  horseBreed: z.string().max(60).optional().or(z.literal("")),
  horseHeightHh: z.coerce.number().min(8).max(20).optional(),
  captchaToken: z.string().min(1),
  captchaAnswer: z.string().min(1),
});
