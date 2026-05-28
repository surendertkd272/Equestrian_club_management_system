import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  onboardingSchema,
  ageYears,
  PARENTAL_CONSENT_TEXT,
  PARENTAL_CONSENT_VERSION,
  INDEMNITY_VERSION,
  INJURY_NOC_VERSION,
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
  // parentalConsentJson is a native jsonb column. Build the object directly
  // (no JSON.stringify) — Prisma serialises it for us. Skip the column
  // entirely (undefined) when not a minor; that leaves the DB default (NULL).
  let parentalConsentJson: Record<string, unknown> | undefined;
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
    parentalConsentJson = {
      signedAt: new Date().toISOString(),
      parentName: d.parentName,
      parentRelation: d.parentRelation,
      parentPhone: d.parentPhone,
      parentEmail: d.parentEmail || null,
      ip,
      ua,
      consentText: PARENTAL_CONSENT_TEXT,
      consentVersion: PARENTAL_CONSENT_VERSION,
    };
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
      // Record when the BMI was measured so the rider profile shows
      // freshness (a 6-month-old BMI for a growing child is stale).
      bmiMeasuredAt: d.heightCm && d.weightKg ? new Date() : null,
      medicalNotes: d.medicalNotes || null,
      allergies: d.allergies || null,
      indemnitySignedAt: new Date(),
      indemnitySignerIp: ip,
      indemnitySignerUa: ua,
      indemnityVersion: INDEMNITY_VERSION,
      // Content-of-consent: what the rider typed as a signature + which
      // versioned texts were shown at sign time. Pairs with the columns
      // above (the session-identification half) to make the full consent
      // record reproducible if ever challenged.
      indemnityConsentJson: {
        signature: d.fullNameSignature,
        indemnityVersion: INDEMNITY_VERSION,
        nocVersion: INJURY_NOC_VERSION,
        nocAgreed: d.injuryNocAgreed,
        agreedAt: new Date().toISOString(),
      } satisfies Prisma.InputJsonValue,
      // jsonb column — pass the object straight in. `undefined` skips the
      // field (column stays NULL) for adult riders who don't need consent.
      parentalConsentJson: parentalConsentJson as Prisma.InputJsonValue | undefined,
      // Public self-enrol → held for School Admin / Centre Manager approval.
      // The registration invoice is created on approval (see
      // /api/enrolments/[id]), not here, so we don't bill un-vetted signups.
      selfEnrolled: true,
      status: "pending_approval",
    },
  });

  await audit({
    action: "create",
    tableName: "rider",
    rowId: rider.id,
    after: { id: rider.id, name: `${rider.firstName} ${rider.lastName}`, centreId: centre.id, status: "pending_approval" },
    ip,
    userAgent: ua,
  });

  await notifyCentreManager(centre.id, {
    type: "rider.self_enrolled",
    title: "New self-enrolment — approval needed",
    body: `${rider.firstName} ${rider.lastName} (${rider.mobile}) signed up via the public link. Review and approve to start registration.`,
    link: `/enrolments`,
    payload: { riderId: rider.id },
  });

  return NextResponse.json({ riderId: rider.id, status: "pending_approval" });
}
