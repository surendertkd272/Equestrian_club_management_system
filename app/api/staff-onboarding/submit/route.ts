// Public submit for the employee self-registration link. No session — the
// tokenised draft (created by an admin) is the gate. Saves the form + flips
// the row to "submitted" for admin review. One submission per link.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notifyCentreManager } from "@/lib/notify";
import { submitOnboardingSchema } from "@/lib/schemas/onboarding-staff";
import { hashOnboardingToken } from "@/lib/onboarding-token";
import { encryptPII } from "@/lib/pii";

export const runtime = "nodejs";

const bodySchema = submitOnboardingSchema.extend({ token: z.string().min(10) });

function dateOnly(s?: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const row = await prisma.employeeOnboarding.findUnique({ where: { tokenHash: hashOnboardingToken(d.token) } });
  if (!row) return NextResponse.json({ error: "INVALID_LINK" }, { status: 404 });
  if (row.expiresAt < new Date()) return NextResponse.json({ error: "LINK_EXPIRED" }, { status: 410 });
  if (row.status !== "draft") return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });

  await prisma.employeeOnboarding.update({
    where: { id: row.id },
    data: {
      fullName: d.fullName,
      fatherName: d.fatherName ?? null,
      emergencyContact: d.emergencyContact ?? null,
      dob: dateOnly(d.dob),
      permanentAddress: d.permanentAddress ?? null,
      email: d.email,
      maritalStatus: d.maritalStatus ?? null,
      aadhaarNumber: encryptPII(d.aadhaarNumber ?? null), // encrypted at rest (lib/pii.ts)
      panNumber: d.panNumber ?? null,
      bankAccountName: d.bankAccountName ?? null,
      bankAccountNumber: d.bankAccountNumber ?? null,
      bankIfsc: d.bankIfsc?.toUpperCase() ?? null,
      bankName: d.bankName ?? null,
      prevEmployment: d.prevEmployment ?? null,
      agreedSalary: d.agreedSalary ?? null,
      foodCharges: d.foodCharges ?? null,
      otherAllowances: d.otherAllowances ?? null,
      pfEsicConsent: d.pfEsicConsent ?? false,
      policeVerificationDetails: d.policeVerificationDetails ?? null,
      employmentType: d.employmentType ?? null,
      dateOfJoining: dateOnly(d.dateOfJoining),
      references: d.references ?? null,
      photoUrl: d.photoUrl ?? null,
      aadhaarUrl: d.aadhaarUrl ?? null,
      panUrl: d.panUrl ?? null,
      bankProofUrl: d.bankProofUrl ?? null,
      prevEmploymentUrl: d.prevEmploymentUrl ?? null,
      policeVerificationUrl: d.policeVerificationUrl ?? null,
      characterCertUrl: d.characterCertUrl ?? null,
      agreementAccepted: true,
      declarationAccepted: true,
      declarationName: d.declarationName,
      status: "submitted",
      submittedAt: new Date(),
      shareToken: null, // link consumed — no longer re-shareable
    },
  });

  await notifyCentreManager(row.centreId, {
    type: "staff_onboarding.submitted",
    title: `New employee registration — ${d.fullName}`,
    body: "An employee completed the self-registration form. Review and approve to add them.",
    link: "/staff/onboarding",
    payload: { onboardingId: row.id },
  });

  return NextResponse.json({ ok: true });
}
