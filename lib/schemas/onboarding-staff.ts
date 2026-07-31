import { z } from "zod";
import { emailIdentity } from "@/lib/email-normalize";
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

// Version tags for the consent text. Bump these WHENEVER the wording above
// changes, so every acceptance is provably tied to the exact text shown. The
// submission flow records the version (+ a hash) it displayed, so you can always
// prove which wording a given employee agreed to — even after a later edit.
export const ONBOARDING_AGREEMENT_VERSION = "2026-07-15";
export const ONBOARDING_DECLARATION_VERSION = "2026-07-15";

// Hindi rendering of the same agreement + declaration, shown alongside English
// so a non-English-reading employee genuinely understands what they accept
// (removes the "someone ticked it, I don't read English" dispute). The English
// text remains the legally-operative version; Hindi is a faithful translation.
export const ONBOARDING_AGREEMENT_HI = `यह फ़ॉर्म जमा करके मैं सहमति देता/देती हूँ कि:
• नौकरी छोड़ने से पहले मैं कंपनी को कम से कम तीन (3) महीने का नोटिस दूँगा/दूँगी। ऐसा न करने पर मैं नोटिस अवधि के बराबर राशि का भुगतान करूँगा/करूँगी, और कोई भी बकाया राशि ज़ब्त की जा सकती है।
• मैं स्कूल परिसर के अंदर शराब, पान मसाला/गुटखा या सिगरेट/बीड़ी का सेवन नहीं करूँगा/करूँगी, ऐसा करने पर मुझे तुरंत नौकरी से हटाया जा सकता है।
• मैं स्कूल के स्टाफ़ और विद्यार्थियों के साथ हमेशा शालीनता से पेश आऊँगा/आऊँगी और किसी भी स्थिति में अभद्र व्यवहार नहीं करूँगा/करूँगी। मैं साफ़-सुथरा रहूँगा/रहूँगी और क्लास के समय राइडिंग यूनिफ़ॉर्म पहनूँगा/पहनूँगी।
• मैं अपने पिछले संस्थान से चरित्र प्रमाण-पत्र जमा करूँगा/करूँगी और दो संदर्भ (references) उनके संपर्क विवरण सहित दूँगा/दूँगी।`;

export const ONBOARDING_DECLARATION_HI = `मैं एतद्द्वारा घोषणा करता/करती हूँ कि:
1. इस फ़ॉर्म में मेरे द्वारा दी गई सभी जानकारी और दस्तावेज़ मेरी सर्वोत्तम जानकारी के अनुसार सत्य, सही और असली हैं।
2. मेरे विरुद्ध कोई आपराधिक मामला लंबित या विचाराधीन नहीं है, और मुझे किसी भी न्यायालय द्वारा कभी किसी अपराध के लिए दोषी नहीं ठहराया गया है।
3. मैं अपने पद के कर्तव्यों को निभाने के लिए चिकित्सकीय रूप से स्वस्थ हूँ।
4. मैंने ऊपर दी गई एग्रीमेंट और आचरण संबंधी शर्तों को पढ़ लिया है, समझ लिया है और स्वीकार करता/करती हूँ।
5. मैं समझता/समझती हूँ कि कोई भी झूठी घोषणा या तथ्यों को छिपाना, मेरी अपनी जोखिम और ज़िम्मेदारी पर, मेरी नियुक्ति की तत्काल समाप्ति का कारण बन सकता है।

मैं नीचे अपना पूरा नाम टाइप करके इस घोषणा को स्वीकार करता/करती हूँ, जो मेरे कानूनी इलेक्ट्रॉनिक हस्ताक्षर के रूप में मान्य है।`;

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
  email: emailIdentity(),
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
  aadhaarBackUrl: optUrl,
  panUrl: optUrl,
  bankProofUrl: optUrl,
  prevEmploymentUrl: optUrl,
  policeVerificationUrl: optUrl,
  characterCertUrl: optUrl,
  // Consent + legal declaration — both must be accepted, name typed.
  agreementAccepted: z.literal(true),
  declarationAccepted: z.literal(true),
  declarationName: z.string().min(2).max(120),
  // Which language the employee read + accepted the consent in ("en"|"hi").
  // Recorded for proof; English remains the legally-operative text.
  consentLang: z.enum(["en", "hi"]).optional().default("en"),
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
  role: z.enum(ROLES).optional(), // intended role — pre-fills the approval step
  expiresDays: z.coerce.number().int().min(1).max(60).default(14),
});

// Admin approves a submission → creates the User + Staff.
export const approveOnboardingSchema = z.object({
  role: z.enum(ROLES),
  salaryBand: z.string().max(40).optional(),
});
