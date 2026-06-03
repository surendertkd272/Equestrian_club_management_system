// Canonical list of every onboarding form item, used to compute what's still
// "pending" on an EmployeeOnboarding record after approval. Per the rule,
// EVERY blank field counts as pending; admins/super-admins waive what doesn't
// apply. fullName/email are required at submit and the agreement/declaration
// are always set, so they aren't tracked here.

export type OnboardingItem = { key: string; label: string; type: "doc" | "detail" };

export const ONBOARDING_ITEMS: OnboardingItem[] = [
  // Details
  { key: "fatherName", label: "Father's name", type: "detail" },
  { key: "emergencyContact", label: "Emergency contact (name & no.)", type: "detail" },
  { key: "dob", label: "Date of birth", type: "detail" },
  { key: "permanentAddress", label: "Permanent address", type: "detail" },
  { key: "maritalStatus", label: "Marital status", type: "detail" },
  { key: "aadhaarNumber", label: "Aadhaar number", type: "detail" },
  { key: "panNumber", label: "PAN number", type: "detail" },
  { key: "bankName", label: "Bank name", type: "detail" },
  { key: "bankAccountName", label: "Account holder name", type: "detail" },
  { key: "bankAccountNumber", label: "Bank account number", type: "detail" },
  { key: "bankIfsc", label: "IFSC", type: "detail" },
  { key: "employmentType", label: "Employment type", type: "detail" },
  { key: "dateOfJoining", label: "Date of joining", type: "detail" },
  { key: "agreedSalary", label: "Agreed monthly salary", type: "detail" },
  { key: "foodCharges", label: "Monthly food charges", type: "detail" },
  { key: "otherAllowances", label: "Other allowances", type: "detail" },
  { key: "policeVerificationDetails", label: "Police verification details", type: "detail" },
  { key: "prevEmployment", label: "Previous employment details", type: "detail" },
  { key: "references", label: "Two references", type: "detail" },
  // Documents
  { key: "photoUrl", label: "Passport photo", type: "doc" },
  { key: "aadhaarUrl", label: "Aadhaar card", type: "doc" },
  { key: "panUrl", label: "PAN card", type: "doc" },
  { key: "bankProofUrl", label: "Bank proof (cancelled cheque / passbook)", type: "doc" },
  { key: "prevEmploymentUrl", label: "Previous-employment certificate", type: "doc" },
  { key: "characterCertUrl", label: "Character certificate", type: "doc" },
  { key: "policeVerificationUrl", label: "Police verification certificate", type: "doc" },
];

export const ONBOARDING_ITEM_KEYS = ONBOARDING_ITEMS.map((i) => i.key);

export function parseWaived(json: unknown): string[] {
  if (Array.isArray(json)) return json.filter((x): x is string => typeof x === "string");
  return [];
}

// Items still blank on the record and not waived.
export function pendingItems(record: Record<string, unknown>, waived: string[]): OnboardingItem[] {
  const w = new Set(waived);
  return ONBOARDING_ITEMS.filter((it) => {
    if (w.has(it.key)) return false;
    const v = record[it.key];
    return v === null || v === undefined || v === "";
  });
}
