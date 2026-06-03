// The logged-in employee completes any still-blank onboarding fields/documents
// from their "My Documents" page. Updates their own EmployeeOnboarding record
// and syncs the key documents onto their Staff/User record.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { completeOnboardingSchema } from "@/lib/schemas/onboarding-staff";

function dateOnly(s?: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const ob = await prisma.employeeOnboarding.findFirst({
    where: { createdUserId: session.userId, status: "approved" },
  });
  if (!ob) return NextResponse.json({ error: "NO_ONBOARDING" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = completeOnboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Only write fields the employee actually provided (blanks transform to
  // undefined upstream), so we never null out something already filled.
  const data: Record<string, unknown> = { ...d };
  if (d.dob !== undefined) data.dob = dateOnly(d.dob);
  if (d.dateOfJoining !== undefined) data.dateOfJoining = dateOnly(d.dateOfJoining);
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];

  await prisma.employeeOnboarding.update({ where: { id: ob.id }, data });

  // Keep the Staff/User record in sync for the headline documents.
  if (ob.createdStaffId) {
    const staffData: Record<string, unknown> = {};
    if (d.aadhaarUrl) staffData.aadhaarUrl = d.aadhaarUrl;
    if (d.policeVerificationUrl) {
      staffData.policeVerificationUrl = d.policeVerificationUrl;
      staffData.policeVerifiedAt = new Date();
    }
    if (Object.keys(staffData).length) {
      await prisma.staff.update({ where: { id: ob.createdStaffId }, data: staffData });
    }
  }
  if (d.photoUrl) {
    await prisma.user.update({ where: { id: session.userId }, data: { photoUrl: d.photoUrl } });
  }

  return NextResponse.json({ ok: true });
}
