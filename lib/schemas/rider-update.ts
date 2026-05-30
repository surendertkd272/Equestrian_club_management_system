import { z } from "zod";

// PATCH payload for /api/riders/[id]. Every field optional — caller sends
// only what they changed. Keeps the API friendly for partial edits from
// the future per-field inline editors.
//
// Out of scope for this endpoint (handled by dedicated routes / system):
//   - centreId, userId, batchId, coachId  — separate flows
//   - bmi, bmiMeasuredAt                  — recomputed from height/weight
//   - indemnity*, tcs*, rules*, parentalConsent*  — audit trail, never edited
//   - status, registrationPaid, selfEnrolled, approvedBy*  — admin workflows
//   - createdAt, updatedAt                — automatic

const uploadedUrl = z
  .string()
  .regex(/^\/uploads\/[a-z0-9._-]+$/i, "Must be an /uploads/ URL from our upload endpoint")
  .nullable();

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const updateRiderSchema = z.object({
  // Personal
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  photoUrl: uploadedUrl,
  dob: dateString,
  placeOfBirth: z.string().max(80).nullable(),
  nationality: z.string().max(60).nullable(),
  gender: z.enum(["male", "female", "other"]).nullable(),
  maritalStatus: z.string().max(40).nullable(),
  // ID
  aadhaarNo: z
    .string()
    .regex(/^\d{12}$/, "12 digits")
    .nullable()
    .or(z.literal("").transform(() => null)),
  aadhaarDocUrl: uploadedUrl,
  // Contact
  mobile: z.string().min(7).max(20),
  email: z
    .string()
    .email()
    .nullable()
    .or(z.literal("").transform(() => null)),
  preferredLanguage: z
    .enum(["en", "hi", "ta", "te", "bn", "mr", "gu", "kn", "ml", "pa"])
    .nullable(),
  school: z.string().max(150).nullable(),
  education: z.string().max(120).nullable(),
  occupation: z.string().max(120).nullable(),
  // Address
  addressPresent: z.string().max(300).nullable(),
  addressPermanent: z.string().max(300).nullable(),
  pincode: z
    .string()
    .regex(/^\d{6}$/, "6-digit PIN")
    .nullable()
    .or(z.literal("").transform(() => null)),
  // Parents + emergency
  fatherName: z.string().max(120).nullable(),
  fatherPhone: z.string().max(20).nullable(),
  motherName: z.string().max(120).nullable(),
  motherPhone: z.string().max(20).nullable(),
  emergencyName: z.string().max(120).nullable(),
  emergencyPhone: z.string().max(20).nullable(),
  // Anthropometrics — server recomputes bmi + bmiMeasuredAt when either changes
  heightCm: z.coerce.number().positive().max(250).nullable(),
  weightKg: z.coerce.number().positive().max(300).nullable(),
  // Medical
  medicalNotes: z.string().max(2000).nullable(),
  allergies: z.string().max(1000).nullable(),
  // Riding
  currentLevel: z.string().max(60).nullable(),
  // State / national IDs
  stateRiderId: z.string().max(60).nullable(),
  efiRiderId: z.string().max(60).nullable(),
}).partial();

export type UpdateRiderInput = z.infer<typeof updateRiderSchema>;
