import { z } from "zod";
import { indianMobile, indianPhone } from "@/lib/schemas/phone";

// Internal-URL whitelist for uploaded files. lib/storage.ts returns `/uploads/<file>`
// from both backends (local FS in dev, S3 via next.config rewrite in prod), so this regex
// covers both. Rejects external URLs to stop someone planting a third-party image (which
// would also leak referrer info).
const uploadedUrl = z
  .string()
  .regex(/^\/uploads\/[a-z0-9._-]+$/i, "Must be an /uploads/ URL from our upload endpoint")
  .optional()
  .or(z.literal(""));

// A date of birth must parse, sit in the past, and be humanly plausible.
// Without the bounds, fumbling the year on an Android date spinner had two
// silent consequences: a future DOB was stored as-is, and a 1916 DOB made a
// 9-year-old read as an adult, so the DPDPA parental-consent block the parent
// had just filled in was discarded and never written to the record.
const dobString = z
  .string()
  .min(1, "Required")
  .refine((s) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    if (d.getTime() > now.getTime()) return false;
    const oldest = new Date(now.getFullYear() - 100, now.getMonth(), now.getDate());
    return d.getTime() >= oldest.getTime();
  }, "Enter a real date of birth (in the past, within the last 100 years)");

export const personalSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  dob: dobString,
  placeOfBirth: z.string().optional(),
  nationality: z.string().optional(),
  gender: z.enum(["male", "female", "other"]),
  maritalStatus: z.string().optional(),
  mobile: indianMobile(),
  email: z.string().email().optional().or(z.literal("")),
  aadhaarNo: z.string().regex(/^\d{12}$/, "12 digits").optional().or(z.literal("")),
  aadhaarDocUrl: uploadedUrl,
  aadhaarBackDocUrl: uploadedUrl,
  photoUrl: uploadedUrl,
  school: z.string().max(150).optional(),
  // Free text, not a dropdown — see the schema note on Rider.schoolClass.
  schoolClass: z.string().max(40).optional(),
  schoolSection: z.string().max(20).optional(),
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
  fatherPhone: indianMobile().optional().or(z.literal("")),
  motherName: z.string().optional(),
  motherPhone: indianMobile().optional().or(z.literal("")),
  emergencyName: z.string().min(1, "Required"),
  emergencyPhone: indianPhone("Enter a reachable emergency number"),
});

// Height/weight are OPTIONAL at registration (field feedback: medical data
// often isn't collected yet when the form is filled — don't block submission).
// The `.or(literal "")` branch tolerates an emptied number input, which the
// browser submits as "" (z.coerce would turn that into 0 and fail positive()).
export const medicalSchema = z.object({
  heightCm: z.coerce.number().positive().max(250).optional().or(z.literal("").transform(() => undefined)),
  weightKg: z.coerce.number().positive().max(300).optional().or(z.literal("").transform(() => undefined)),
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

// Versioned indemnity text — the wording shown to the rider on the
// IndemnityStep of the wizard. Pinned so when wording later revs, signed
// records still reference the exact paragraph that was agreed to.
export const INDEMNITY_VERSION = "v1";
export const INDEMNITY_TEXT =
  "I acknowledge that horse riding is an inherently risky activity involving " +
  "large unpredictable animals. I voluntarily assume all risks of injury, " +
  "including but not limited to falls, kicks, bites, and equipment failure. " +
  "I release Equiwings, its centres, employees, contractors, and agents from " +
  "any and all claims arising out of my participation. I confirm that the " +
  "medical and contact information provided is accurate, and I authorise " +
  "emergency medical treatment if required. I understand that registration & " +
  "membership fees are non-refundable, and that 15 days of un-notified " +
  "absence may result in cancellation of membership.";

// DPDPA Section 9 — verifiable parental consent. The fields are optional
// at the schema level; the onboarding handler checks them only when the
// rider is under 18. We keep the agreed-text version pinned so a future
// ToS rev doesn't retroactively alter what the parent agreed to.
export const parentalConsentSchema = z.object({
  parentName: z.string().min(1).max(120).optional(),
  parentRelation: z.enum(["father", "mother", "guardian"]).optional(),
  parentPhone: indianMobile().optional().or(z.literal("")),
  parentEmail: z.string().email().optional().or(z.literal("")),
  parentConsentAgreed: z.boolean().optional(),
});

// Strict version of the above — used by the wizard's ParentalConsentStep
// when the entered DOB makes the rider a minor. Same field names; the
// "optional" sides become "required" so the user fills the step before
// it lets them move on. The API in app/api/onboarding/route.ts already
// enforces these for minors; this just surfaces the validation in the
// browser instead of after submission.
export const parentalConsentRequiredSchema = z.object({
  parentName: z.string().min(1, "Parent's full name required").max(120),
  parentRelation: z.enum(["father", "mother", "guardian"], {
    errorMap: () => ({ message: "Select a relation" }),
  }),
  parentPhone: indianMobile("Parent's 10-digit mobile number"),
  parentEmail: z.string().email("Valid email").optional().or(z.literal("")),
  parentConsentAgreed: z.literal(true, {
    errorMap: () => ({ message: "Parent must agree to the consent text" }),
  }),
});

export const onboardingSchema = personalSchema
  .merge(addressSchema)
  .merge(parentsSchema)
  .merge(medicalSchema)
  .merge(indemnitySchema)
  .merge(parentalConsentSchema)
  .extend({
    centreSlug: z.string().min(1),
    // No captcha fields — the rider form does not use one. Kept optional-free
    // rather than optional-and-ignored so nothing sends a value that quietly
    // goes nowhere. See the note in /api/onboarding for why.
  });

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
