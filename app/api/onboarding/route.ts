import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  onboardingSchema,
  ageYears,
  PARENTAL_CONSENT_TEXT,
  PARENTAL_CONSENT_VERSION,
} from "@/lib/schemas/rider-onboarding";
import { calcBmi } from "@/lib/utils";
import { audit } from "@/lib/audit";
import { notifyCentreManager } from "@/lib/notify";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const centre = await prisma.centre.findUnique({ where: { slug: d.centreSlug } });
  if (!centre) return NextResponse.json({ error: "CENTRE_NOT_FOUND" }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
  const ua = req.headers.get("user-agent") ?? null;

  // DPDPA Section 9: when the rider is a minor (under 18 at signup) we
  // require the parental-consent block. The fields are optional in the
  // schema because adult riders don't need them; here we promote them to
  // hard requirements once age makes them necessary.
  const isMinor = ageYears(new Date(d.dob)) < 18;
  let parentalConsentJson: string | null = null;
  if (isMinor) {
    const missing: string[] = [];
    if (!d.parentName) missing.push("parentName");
    if (!d.parentRelation) missing.push("parentRelation");
    if (!d.parentPhone) missing.push("parentPhone");
    if (d.parentConsentAgreed !== true) missing.push("parentConsentAgreed");
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "PARENTAL_CONSENT_REQUIRED",
          message: "DPDPA requires verifiable parental consent for riders under 18.",
          missing,
        },
        { status: 400 },
      );
    }
    parentalConsentJson = JSON.stringify({
      signedAt: new Date().toISOString(),
      parentName: d.parentName,
      parentRelation: d.parentRelation,
      parentPhone: d.parentPhone,
      parentEmail: d.parentEmail || null,
      ip,
      ua,
      consentText: PARENTAL_CONSENT_TEXT,
      consentVersion: PARENTAL_CONSENT_VERSION,
    });
  }

  const rider = await prisma.rider.create({
    data: {
      centreId: centre.id,
      firstName: d.firstName,
      lastName: d.lastName,
      dob: new Date(d.dob),
      placeOfBirth: d.placeOfBirth || null,
      nationality: d.nationality || null,
      gender: d.gender,
      maritalStatus: d.maritalStatus || null,
      mobile: d.mobile,
      email: d.email || null,
      aadhaarNo: d.aadhaarNo || null,
      aadhaarDocUrl: d.aadhaarDocUrl || null,
      photoUrl: d.photoUrl || null,
      school: d.school || null,
      education: d.education || null,
      occupation: d.occupation || null,
      addressPresent: d.addressPresent,
      addressPermanent: d.addressPermanent || d.addressPresent,
      pincode: d.pincode,
      fatherName: d.fatherName || null,
      fatherPhone: d.fatherPhone || null,
      motherName: d.motherName || null,
      motherPhone: d.motherPhone || null,
      emergencyName: d.emergencyName,
      emergencyPhone: d.emergencyPhone,
      heightCm: d.heightCm,
      weightKg: d.weightKg,
      bmi: calcBmi(d.heightCm, d.weightKg),
      medicalNotes: d.medicalNotes || null,
      allergies: d.allergies || null,
      indemnitySignedAt: new Date(),
      indemnitySignerIp: ip,
      indemnitySignerUa: ua,
      parentalConsentJson,
      status: "pending_payment",
    },
  });

  // Create a registration invoice (defaults to ₹3,000 per GHRC).
  const regPlan = await prisma.feePlan.findFirst({ where: { centreId: centre.id } });
  const regAmount = regPlan?.registrationAmount ?? 3000;
  const invoice = await prisma.invoice.create({
    data: {
      centreId: centre.id,
      riderId: rider.id,
      amount: regAmount,
      gstAmount: 0,
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      kind: "registration",
      status: "due",
    },
  });

  await audit({
    action: "create",
    tableName: "rider",
    rowId: rider.id,
    after: { id: rider.id, name: `${rider.firstName} ${rider.lastName}`, centreId: centre.id },
    ip,
    userAgent: ua,
  });

  await notifyCentreManager(centre.id, {
    type: "rider.onboarded",
    title: "New rider signed up",
    body: `${rider.firstName} ${rider.lastName} (${rider.mobile}) just completed the onboarding wizard. Pending ₹${regAmount} registration payment.`,
    link: `/riders/${rider.id}`,
    payload: { riderId: rider.id, invoiceId: invoice.id },
  });

  return NextResponse.json({ riderId: rider.id, invoiceId: invoice.id, amount: regAmount });
}
