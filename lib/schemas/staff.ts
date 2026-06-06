import { z } from "zod";
import { ROLES } from "@/lib/roles";

// PARENT users are minted from the rider profile flow (one parent per rider
// link), not from Add Staff. EXAMINER + JURY users come in via the Exam
// module, not staff hiring. SUPER_ADMIN + ADMIN sit above the centre tier
// entirely. RIDER obviously can't be a staff role.
const STAFF_ROLES = ROLES.filter(
  (r) => !["SUPER_ADMIN", "ADMIN", "RIDER", "PARENT", "EXAMINER"].includes(r),
) as readonly string[];

export const createStaffSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().min(10).max(20).optional().or(z.literal("")),
  role: z.string().refine((r) => STAFF_ROLES.includes(r), "Invalid staff role"),
  salaryBand: z.string().optional(),
  password: z.string().min(8, "8+ chars").default("password123"),
  // Optional KYC artefacts — URLs returned from /api/upload after the form
  // uploads the actual files. Empty string means "not provided yet".
  aadhaarUrl: z.string().url().optional().or(z.literal("")),
  policeVerificationUrl: z.string().url().optional().or(z.literal("")),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const ASSIGNABLE_STAFF_ROLES = STAFF_ROLES;
