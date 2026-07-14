// PATCH /api/staff-onboarding/[id] — correct a SUBMITTED employee registration
// before approving it (e.g. the applicant mistyped a bank/aadhaar/name). Same
// gate + cross-centre rule as approve. Editable only while status="submitted"
// (once approved, the User/Staff exist — edit those instead). aadhaarNumber is
// re-encrypted at rest; a blank value leaves it unchanged.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { completeOnboardingSchema } from "@/lib/schemas/onboarding-staff";
import { encryptPII } from "@/lib/pii";

function dateOnly(s?: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const ob = await prisma.employeeOnboarding.findUnique({ where: { id: params.id } });
  if (!ob) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && ob.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (ob.status !== "submitted") return NextResponse.json({ error: "NOT_SUBMITTED" }, { status: 409 });

  const body = await req.json().catch(() => null);
  const parsed = completeOnboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Only write keys the caller actually sent (partial edit). Dates + the
  // encrypted Aadhaar number get special handling.
  const data: Record<string, unknown> = {};
  const passthrough = [
    "fullName", "fatherName", "emergencyContact", "permanentAddress", "email", "maritalStatus",
    "panNumber", "bankAccountName", "bankAccountNumber", "bankIfsc", "bankName", "prevEmployment",
    "agreedSalary", "foodCharges", "otherAllowances", "policeVerificationDetails", "employmentType",
    "references", "photoUrl", "aadhaarUrl", "aadhaarBackUrl", "panUrl", "bankProofUrl",
    "prevEmploymentUrl", "policeVerificationUrl", "characterCertUrl",
  ] as const;
  for (const k of passthrough) {
    if (k in d) data[k] = (d as Record<string, unknown>)[k] ?? null;
  }
  if ("bankIfsc" in d && d.bankIfsc) data.bankIfsc = d.bankIfsc.toUpperCase();
  if ("dob" in d) data.dob = dateOnly(d.dob);
  if ("dateOfJoining" in d) data.dateOfJoining = dateOnly(d.dateOfJoining);
  // Aadhaar number is encrypted at rest — only touch it when a new value is
  // supplied (blank = keep existing, since we never prefill the ciphertext).
  if (d.aadhaarNumber) data.aadhaarNumber = encryptPII(d.aadhaarNumber);

  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true, changed: 0 });

  await prisma.employeeOnboarding.update({ where: { id: ob.id }, data });
  await audit({
    userId: session.userId,
    action: "staff_onboarding.edit",
    tableName: "employeeOnboarding",
    rowId: ob.id,
    after: { fields: Object.keys(data) },
  });
  return NextResponse.json({ ok: true });
}
