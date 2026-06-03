// Approve a submitted onboarding → create the User (login) + Staff record from
// it, carrying over documents + KYC data. Returns a one-time temp password.
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { approveOnboardingSchema } from "@/lib/schemas/onboarding-staff";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = approveOnboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const ob = await prisma.employeeOnboarding.findUnique({ where: { id: params.id } });
  if (!ob) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && ob.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (ob.status !== "submitted") return NextResponse.json({ error: "NOT_SUBMITTED" }, { status: 409 });
  if (!ob.email || !ob.fullName) return NextResponse.json({ error: "INCOMPLETE_SUBMISSION" }, { status: 400 });

  const emailTaken = await prisma.user.findUnique({ where: { email: ob.email } });
  if (emailTaken) return NextResponse.json({ error: "EMAIL_TAKEN", email: ob.email }, { status: 409 });

  const tempPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  // Everything the Staff columns don't have a home for is kept on kycDocsJson,
  // so nothing the employee submitted is lost.
  const kyc = {
    panUrl: ob.panUrl,
    bankProofUrl: ob.bankProofUrl,
    prevEmploymentUrl: ob.prevEmploymentUrl,
    characterCertUrl: ob.characterCertUrl,
    photoUrl: ob.photoUrl,
    aadhaarNumber: ob.aadhaarNumber,
    panNumber: ob.panNumber,
    bank: { name: ob.bankName, accountName: ob.bankAccountName, accountNumber: ob.bankAccountNumber, ifsc: ob.bankIfsc },
    dob: ob.dob ? ob.dob.toISOString() : null,
    fatherName: ob.fatherName,
    permanentAddress: ob.permanentAddress,
    emergencyContact: ob.emergencyContact,
    maritalStatus: ob.maritalStatus,
    prevEmployment: ob.prevEmployment,
    agreedSalary: ob.agreedSalary,
    foodCharges: ob.foodCharges,
    otherAllowances: ob.otherAllowances,
    pfEsicConsent: ob.pfEsicConsent,
    employmentType: ob.employmentType,
    references: ob.references,
    policeVerificationDetails: ob.policeVerificationDetails,
    declarationName: ob.declarationName,
    declarationAcceptedAt: ob.submittedAt ? ob.submittedAt.toISOString() : null,
  };

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: ob.fullName!,
        email: ob.email!,
        role: d.role,
        centreId: ob.centreId,
        passwordHash,
        status: "active",
        mustChangePassword: true,
        photoUrl: ob.photoUrl ?? null,
      },
    });
    const staff = await tx.staff.create({
      data: {
        centreId: ob.centreId,
        userId: user.id,
        role: d.role,
        salaryBand: d.salaryBand ?? null,
        status: "active",
        joiningDate: ob.dateOfJoining ?? new Date(),
        aadhaarUrl: ob.aadhaarUrl ?? null,
        policeVerificationUrl: ob.policeVerificationUrl ?? null,
        policeVerifiedAt: ob.policeVerificationUrl ? new Date() : null,
        kycDocsJson: kyc as Prisma.InputJsonValue,
      },
    });
    await tx.employeeOnboarding.update({
      where: { id: ob.id },
      data: {
        status: "approved",
        approvedAt: new Date(),
        reviewedByUserId: session.userId,
        createdStaffId: staff.id,
      },
    });
    return { userId: user.id, staffId: staff.id };
  });

  await audit({
    userId: session.userId,
    action: "staff_onboarding.approved",
    tableName: "employeeOnboarding",
    rowId: ob.id,
    after: { staffId: result.staffId, userId: result.userId, role: d.role },
  });

  return NextResponse.json({ ok: true, ...result, tempPassword });
}
