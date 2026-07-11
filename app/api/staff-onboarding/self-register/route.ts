// Public submit for the REUSABLE per-club employee registration link
// (/onboard/staff?centre=<slug>). Unlike /submit (which consumes a one-time
// admin-issued token), this creates a fresh EmployeeOnboarding row straight
// into "submitted" for admin review. The club slug is the only key — the same
// link works for unlimited applicants, each landing in the approval queue.
//
// Anti-abuse: IP rate-limit (shared queue can't be flooded). No User/Staff is
// created here — that happens only when an admin approves (same approve flow
// as the tokenised path), so a spam submission is inert until reviewed.
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notifyCentreManager } from "@/lib/notify";
import { submitOnboardingSchema } from "@/lib/schemas/onboarding-staff";
import { encryptPII } from "@/lib/pii";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { bindRlsBypass } from "@/lib/tenant-context";

export const runtime = "nodejs";

const bodySchema = submitOnboardingSchema.extend({ centreSlug: z.string().min(1) });

function dateOnly(s?: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export async function POST(req: NextRequest) {
  bindRlsBypass(); // public flow — no session to bind an org from
  const rl = checkRate(`staff-self-register:${clientFingerprint(req)}`, 10, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const centre = await prisma.centre.findUnique({ where: { slug: d.centreSlug }, select: { id: true } });
  if (!centre) return NextResponse.json({ error: "CENTRE_NOT_FOUND" }, { status: 404 });

  const row = await prisma.employeeOnboarding.create({
    data: {
      centreId: centre.id,
      // tokenHash is @unique + NOT NULL (designed for the tokenised path). A
      // self-registration has no shareable token, so store a random synthetic
      // value to satisfy the constraint — it's inert (the token page only
      // resolves status="draft" rows, and this row is created "submitted").
      tokenHash: crypto.randomBytes(32).toString("hex"),
      shareToken: null,
      expiresAt: new Date(), // not used for submitted rows; column is required
      status: "submitted",
      submittedAt: new Date(),
      fullName: d.fullName,
      fatherName: d.fatherName ?? null,
      emergencyContact: d.emergencyContact ?? null,
      dob: dateOnly(d.dob),
      permanentAddress: d.permanentAddress ?? null,
      email: d.email,
      maritalStatus: d.maritalStatus ?? null,
      aadhaarNumber: encryptPII(d.aadhaarNumber ?? null),
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
    },
  });

  await notifyCentreManager(centre.id, {
    type: "staff_onboarding.submitted",
    title: `New employee registration — ${d.fullName}`,
    body: "An employee registered via the public club link. Review and approve to add them.",
    link: "/staff/onboarding",
    payload: { onboardingId: row.id },
  });

  return NextResponse.json({ ok: true });
}
