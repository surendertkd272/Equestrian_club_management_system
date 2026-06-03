import { z } from "zod";
import { ROLES } from "../roles";

// The agreement + conduct terms (from the club's Employee Self Registration &
// Agreement Form). Shown on the onboarding link; the employee ticks to accept.
export const ONBOARDING_AGREEMENT = `By submitting this form I agree that:
• I will give the company at least three (3) months' notice before leaving. Failing this, I will pay the equivalent amount in lieu of notice, and any pending dues may be forfeited.
• I will not consume alcohol, pan masala/gutka or cigarettes/bidi inside the school premises, failing which I may be terminated immediately.
• I will always behave decently with school staff and students and never be rude, regardless of the situation. I will stay neat and tidy and wear the riding uniform during class timings.
• I will submit a character certificate from my last organisation and provide two references with their contact details.`;

// Self-declaration. Legally accepted by typing the employee's own full name.
export const ONBOARDING_DECLARATION = `I hereby declare that:
1. All information and documents I have provided in this form are true, correct and genuine to the best of my knowledge.
2. There is no criminal case pending or contemplated against me, and I have never been convicted of any offence by any court of law.
3. I am medically fit to perform the duties of my role.
4. I have read, understood and accept the agreement and conduct terms stated above.
5. I understand that any false declaration or concealment of facts may lead to immediate termination of my engagement, at my own risk and liability.

I accept this declaration by typing my full name below, which constitutes my legal electronic signature.`;

const optStr = (max: number) => z.string().max(max).optional().or(z.literal("")).transform((v) => v || undefined);
// Document URLs come from our own /api/upload, which returns a relative
// "/uploads/<file>" path (local) or an absolute S3 URL — so accept either,
// not strictly z.url().
const optUrl = z.string().max(500).optional().or(z.literal("")).transform((v) => v || undefined);
const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal(""))
  .transform((v) => v || undefined);

// What the employee submits via the tokenised link (or an admin fills in-system).
export const submitOnboardingSchema = z.object({
  fullName: z.string().min(2).max(120),
  fatherName: optStr(120),
  emergencyContact: optStr(120),
  dob: optDate,
  permanentAddress: optStr(400),
  email: z.string().email(),
  maritalStatus: z.enum(["single", "married", "other"]).optional(),
  aadhaarNumber: optStr(20),
  panNumber: optStr(20),
  bankAccountName: optStr(120),
  bankAccountNumber: optStr(30),
  bankIfsc: optStr(15),
  bankName: optStr(80),
  prevEmployment: optStr(1000),
  agreedSalary: z.coerce.number().min(0).max(100_000_000).optional(),
  foodCharges: z.coerce.number().min(0).max(10_000_000).optional(),
  otherAllowances: optStr(300),
  pfEsicConsent: z.boolean().optional().default(false),
  policeVerificationDetails: optStr(300),
  employmentType: z.enum(["full_time", "trainee_stipend"]).optional(),
  dateOfJoining: optDate,
  references: optStr(600),
  // Uploaded document URLs.
  photoUrl: optUrl,
  aadhaarUrl: optUrl,
  panUrl: optUrl,
  bankProofUrl: optUrl,
  prevEmploymentUrl: optUrl,
  policeVerificationUrl: optUrl,
  characterCertUrl: optUrl,
  // Consent + legal declaration — both must be accepted, name typed.
  agreementAccepted: z.literal(true),
  declarationAccepted: z.literal(true),
  declarationName: z.string().min(2).max(120),
});
export type SubmitOnboardingInput = z.infer<typeof submitOnboardingSchema>;

// Employee completing still-blank fields/documents after approval (from their
// "My Documents" page). All optional — they fill whatever's pending.
export const completeOnboardingSchema = submitOnboardingSchema
  .omit({ agreementAccepted: true, declarationAccepted: true, declarationName: true })
  .partial();

// Admin generates a shareable link.
export const generateOnboardingLinkSchema = z.object({
  centreId: z.string().min(1).optional(), // SUPER_ADMIN/ADMIN may target a centre
  note: z.string().max(120).optional(), // candidate name, for the admin's reference
  expiresDays: z.coerce.number().int().min(1).max(60).default(14),
});

// Admin approves a submission → creates the User + Staff.
export const approveOnboardingSchema = z.object({
  role: z.enum(ROLES),
  salaryBand: z.string().max(40).optional(),
});
