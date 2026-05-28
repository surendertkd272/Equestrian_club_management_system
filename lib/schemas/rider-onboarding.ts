import { z } from "zod";

// Internal-URL whitelist for uploaded files. lib/storage.ts returns `/uploads/<file>`
// from both backends (local FS in dev, S3 via next.config rewrite in prod), so this regex
// covers both. Rejects external URLs to stop someone planting a third-party image (which
// would also leak referrer info).
const uploadedUrl = z
  .string()
  .regex(/^\/uploads\/[a-z0-9._-]+$/i, "Must be an /uploads/ URL from our upload endpoint")
  .optional()
  .or(z.literal(""));

export const personalSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  dob: z.string().min(1, "Required"),
  placeOfBirth: z.string().optional(),
  nationality: z.string().optional(),
  gender: z.enum(["male", "female", "other"]),
  maritalStatus: z.string().optional(),
  mobile: z.string().min(10, "10-digit number"),
  email: z.string().email().optional().or(z.literal("")),
  aadhaarNo: z.string().regex(/^\d{12}$/, "12 digits").optional().or(z.literal("")),
  aadhaarDocUrl: uploadedUrl,
  photoUrl: uploadedUrl,
  school: z.string().max(150).optional(),
  education: z.string().optional(),
  occupation: z.string().optional(),
});

export const addressSchema = z.object({
  addressPresent: z.string().min(1, "Required"),
  addressPermanent: z.string().optional(),
  pincode: z.string().regex(/^\d{6}$/, "6-digit PIN"),
});

export const parentsSchema = z.object({
  fatherName: z.string().optional(),
  fatherPhone: z.string().optional(),
  motherName: z.string().optional(),
  motherPhone: z.string().optional(),
  emergencyName: z.string().min(1, "Required"),
  emergencyPhone: z.string().min(10, "Required"),
});

export const medicalSchema = z.object({
  heightCm: z.coerce.number().positive("Required").max(250),
  weightKg: z.coerce.number().positive("Required").max(300),
  medicalNotes: z.string().optional(),
  allergies: z.string().optional(),
});

export const indemnitySchema = z.object({
  fullNameSignature: z.string().min(1, "Type full name to sign"),
  agreed: z.literal(true, { errorMap: () => ({ message: "You must agree to the indemnity terms" }) }),
  // NOC for injuries — a separate, explicit acknowledgement that horse-riding
  // injuries can happen and the rider/guardian will not hold the centre liable.
  // Kept distinct from the broader `agreed` checkbox so the consent record is
  // unambiguous: both must be ticked. The text shown is pinned by
  // INJURY_NOC_VERSION below so future wording changes don't retroactively
  // alter what was agreed.
  injuryNocAgreed: z.literal(true, { errorMap: () => ({ message: "Tick the injury NOC to continue" }) }),
});

// Versioned NOC text — if this changes, bump INJURY_NOC_VERSION so consent
// records persisted before the change stay valid (they reference v1).
export const INJURY_NOC_VERSION = "v1";
export const INJURY_NOC_TEXT =
  "I (the rider, or parent/guardian for minors) give my No-Objection Consent " +
  "for the rider to participate in horse-riding activity at this centre. I " +
  "acknowledge that riding involves a real risk of injury — falls, kicks, " +
  "bites, equipment failure, and unpredictable horse behaviour can occur " +
  "even under qualified supervision. I will not hold Equiwings, the centre, " +
  "its coaches, grooms, or contractors liable for injuries sustained in the " +
  "normal course of training, competition, or stable work. Centre staff will " +
  "still administer reasonable first aid and authorise emergency medical " +
  "care if needed.";

// DPDPA Section 9 — verifiable parental consent. The fields are optional
// at the schema level; the onboarding handler checks them only when the
// rider is under 18. We keep the agreed-text version pinned so a future
// ToS rev doesn't retroactively alter what the parent agreed to.
export const parentalConsentSchema = z.object({
  parentName: z.string().min(1).max(120).optional(),
  parentRelation: z.enum(["father", "mother", "guardian"]).optional(),
  parentPhone: z.string().min(10).max(20).optional(),
  parentEmail: z.string().email().optional().or(z.literal("")),
  parentConsentAgreed: z.boolean().optional(),
});

export const onboardingSchema = personalSchema
  .merge(addressSchema)
  .merge(parentsSchema)
  .merge(medicalSchema)
  .merge(indemnitySchema)
  .merge(parentalConsentSchema)
  .extend({ centreSlug: z.string().min(1) });

export type OnboardingInput = z.infer<typeof onboardingSchema>;

// The exact text the parent agrees to. Versioned so we can prove what was
// shown at consent time even if the wording later changes.
export const PARENTAL_CONSENT_VERSION = "v1";
export const PARENTAL_CONSENT_TEXT =
  "I am the parent/legal guardian of the rider named above. I consent under " +
  "India's Digital Personal Data Protection Act 2023 (Section 9) to the " +
  "processing of my child's personal data by Equiwings and the operating " +
  "equestrian centre for the purposes of registration, training records, " +
  "exam results, medical safety, and parent communication. I understand " +
  "I may withdraw consent at any time via my account or by writing to the " +
  "centre, subject to records the centre is legally required to retain.";

export function ageYears(dob: Date, now = new Date()): number {
  let years = now.getFullYear() - dob.getFullYear();
  const md = (now.getMonth() - dob.getMonth()) || (now.getDate() - dob.getDate());
  if (md < 0) years -= 1;
  return years;
}
