import { z } from "zod";
import { ROLES } from "@/lib/roles";

// PARENT users are minted from the rider profile flow (one parent per rider
// link), not from Add Staff. EXAMINER + JURY users come in via the Exam
// module, not staff hiring. SUPER_ADMIN + ADMIN sit above the centre tier
// entirely. RIDER obviously can't be a staff role.
const STAFF_ROLES = ROLES.filter(
  (r) => !["SUPER_ADMIN", "ADMIN", "RIDER", "PARENT", "EXAMINER"].includes(r),
) as readonly string[];

// Uploaded-document reference: a relative "/uploads/<file>" path (Supabase /
// local) or an absolute S3 URL. Deliberately NOT z.string().url() — that
// rejects the relative paths /api/upload actually returns.
const docUrl = z.string().max(500).optional().or(z.literal(""));

export const createStaffSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().min(10).max(20).optional().or(z.literal("")),
  role: z.string().refine((r) => STAFF_ROLES.includes(r), "Invalid staff role"),
  salaryBand: z.string().optional(),
  // Optional real date of joining — set it for employees who were part of the
  // club before being entered into the system. Left empty, joiningDate defaults
  // to now() at the DB layer. Regex-guarded so a malformed date can't reach
  // new Date() on the server (the UI already uses a native date picker).
  joiningDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
  password: z.string().min(8, "8+ chars").default("password123"),
  // Optional KYC artefacts — paths returned from /api/upload after the form
  // uploads the files. NOTE: /api/upload returns a RELATIVE "/uploads/<file>"
  // path (Supabase/local), which z.string().url() REJECTS — that bug made
  // every Add-Staff submission fail the moment a document was attached. Accept
  // the relative path (or an absolute S3 URL) as a plain bounded string.
  aadhaarUrl: docUrl,
  aadhaarBackUrl: docUrl,
  policeVerificationUrl: docUrl,
  // Full KYC document set (previously only self-registration captured these;
  // Add Staff now does too). photo/PAN/bank-proof are stored in kycDocsJson.
  photoUrl: docUrl,
  panUrl: docUrl,
  bankProofUrl: docUrl,
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const ASSIGNABLE_STAFF_ROLES = STAFF_ROLES;
