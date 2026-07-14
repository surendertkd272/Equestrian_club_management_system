// Shared helpers for the employee profile + printable packet (admin/super-admin).
// An employee's registration data lives on their EmployeeOnboarding row when
// they were hired through the self-registration flow; for manually-added staff
// we synthesise the same shape from Staff.kycDocsJson + the linked User so the
// profile and print packet work uniformly either way.
import { prisma } from "./prisma";
import { tenantWhere } from "./tenancy";
import { ONBOARDING_ITEMS } from "./onboarding-items";
import { formatDate } from "./utils";
import { decryptPIISafe } from "./pii";

export type EmployeeDoc = { key: string; label: string; url: string; isPdf: boolean };

// The uploadable documents, in the order they appear on the form.
const DOC_LABELS: Record<string, string> = {
  photoUrl: "Passport photo",
  aadhaarUrl: "Aadhaar card (front)",
  aadhaarBackUrl: "Aadhaar card (back)",
  panUrl: "PAN card",
  bankProofUrl: "Bank proof (cheque / passbook)",
  prevEmploymentUrl: "Previous-employment certificate",
  characterCertUrl: "Character certificate",
  policeVerificationUrl: "Police verification certificate",
};
export const EMPLOYEE_DOC_KEYS = Object.keys(DOC_LABELS);

// Only the documents that actually have a stored URL, tagged image-vs-PDF
// (uploaded URLs keep their real extension — see lib/storage.ts).
export function employeeDocs(rec: Record<string, unknown>): EmployeeDoc[] {
  return EMPLOYEE_DOC_KEYS.flatMap((key) => {
    const url = rec[key];
    if (typeof url !== "string" || url === "") return [];
    const isPdf = url.toLowerCase().split("?")[0].endsWith(".pdf");
    return [{ key, label: DOC_LABELS[key], url, isPdf }];
  });
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function fmtValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (key === "dob" || key === "dateOfJoining") {
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : formatDate(d);
  }
  if (key === "agreedSalary" || key === "foodCharges") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isNaN(n) ? String(v) : inr(n);
  }
  if (key === "employmentType") return String(v).replaceAll("_", " ");
  return String(v);
}

export type FormRow = { label: string; value: string };

// The registration form as label/value rows, in form order. fullName/email are
// required at submit (not in ONBOARDING_ITEMS) so they're prepended explicitly.
export function employeeFormRows(rec: Record<string, unknown>): FormRow[] {
  const rows: FormRow[] = [
    { label: "Full name", value: fmtValue("fullName", rec.fullName) },
    { label: "Email", value: fmtValue("email", rec.email) },
  ];
  for (const it of ONBOARDING_ITEMS) {
    if (it.type !== "detail") continue;
    // Aadhaar number is encrypted at rest (lib/pii.ts) — decrypt for display.
    // This funnel serves the pre-approval onboarding record, the approved
    // staff record (via synthRecordFromStaff), and the print packet alike.
    const raw = it.key === "aadhaarNumber" ? decryptPIISafe(rec[it.key] as string | null) : rec[it.key];
    rows.push({ label: it.label, value: fmtValue(it.key, raw) });
  }
  return rows;
}

// Build the unified record from a manually-added staff member (no onboarding row).
// kyc mirrors the keys the approve route writes onto Staff.kycDocsJson.
export function synthRecordFromStaff(
  staff: { joiningDate: Date; aadhaarUrl: string | null; aadhaarBackUrl?: string | null; policeVerificationUrl: string | null; kycDocsJson: unknown },
  user: { name: string; email: string; photoUrl: string | null },
): Record<string, unknown> {
  const kyc = (staff.kycDocsJson && typeof staff.kycDocsJson === "object" ? staff.kycDocsJson : {}) as Record<
    string,
    unknown
  >;
  const bank = (kyc.bank && typeof kyc.bank === "object" ? kyc.bank : {}) as Record<string, unknown>;
  return {
    fullName: user.name,
    email: user.email,
    fatherName: kyc.fatherName,
    emergencyContact: kyc.emergencyContact,
    dob: kyc.dob,
    permanentAddress: kyc.permanentAddress,
    maritalStatus: kyc.maritalStatus,
    aadhaarNumber: kyc.aadhaarNumber,
    panNumber: kyc.panNumber,
    bankName: bank.name,
    bankAccountName: bank.accountName,
    bankAccountNumber: bank.accountNumber,
    bankIfsc: bank.ifsc,
    employmentType: kyc.employmentType,
    dateOfJoining: staff.joiningDate,
    agreedSalary: kyc.agreedSalary,
    foodCharges: kyc.foodCharges,
    otherAllowances: kyc.otherAllowances,
    policeVerificationDetails: kyc.policeVerificationDetails,
    prevEmployment: kyc.prevEmployment,
    references: kyc.references,
    // Documents
    photoUrl: kyc.photoUrl ?? user.photoUrl,
    aadhaarUrl: staff.aadhaarUrl,
    aadhaarBackUrl: staff.aadhaarBackUrl ?? null,
    panUrl: kyc.panUrl,
    bankProofUrl: kyc.bankProofUrl,
    prevEmploymentUrl: kyc.prevEmploymentUrl,
    characterCertUrl: kyc.characterCertUrl,
    policeVerificationUrl: staff.policeVerificationUrl,
    declarationName: kyc.declarationName,
  };
}

export type EmployeeProfile = {
  staff: {
    id: string;
    role: string;
    status: string;
    joiningDate: Date;
    name: string;
    email: string;
    phone: string | null;
  };
  record: Record<string, unknown>;
  docs: EmployeeDoc[];
  declarationName: string | null;
  hasOnboarding: boolean;
};

// Load a staff member's profile + registration data + uploaded documents,
// scoped to the caller's centre (centreId null = HQ, sees all). Prefers the
// EmployeeOnboarding row; falls back to synthesising from the Staff record.
export async function loadEmployeeProfile(staffId: string, centreId: string | null, orgId: string | null): Promise<EmployeeProfile | null> {
  // Org-scope (C1): HQ ("all centres", centreId null) is bounded to its own org,
  // not every tenant's staff. Fail closed if the caller's org can't be resolved.
  if (!orgId) return null;
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, ...tenantWhere(centreId, orgId) },
    include: { user: { select: { name: true, email: true, phone: true, photoUrl: true } } },
  });
  if (!staff) return null;

  const ob = await prisma.employeeOnboarding.findFirst({
    where: { createdStaffId: staff.id },
    orderBy: { approvedAt: "desc" },
  });

  const record = ob
    ? (ob as unknown as Record<string, unknown>)
    : synthRecordFromStaff(staff, staff.user);
  // Staff.joiningDate is the authoritative, editable joining date (staff edit
  // form). The onboarding row carries its own dateOfJoining snapshot from
  // submission time; surface the live value so the profile + print packet don't
  // show a stale date after an admin corrects it.
  record.dateOfJoining = staff.joiningDate;

  return {
    staff: {
      id: staff.id,
      role: staff.role,
      status: staff.status,
      joiningDate: staff.joiningDate,
      name: staff.user.name,
      email: staff.user.email,
      phone: staff.user.phone,
    },
    record,
    docs: employeeDocs(record),
    declarationName: typeof record.declarationName === "string" ? record.declarationName : null,
    hasOnboarding: !!ob,
  };
}

