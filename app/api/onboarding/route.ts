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
import { encryptPII, last4 } from "@/lib/pii";
import { audit } from "@/lib/audit";
import { notifyCentreManager } from "@/lib/notify";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { isFeatureEnabledForCentre } from "@/lib/features-gate";
import { bindRlsBypass } from "@/lib/tenant-context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  bindRlsBypass(); // public-by-unguessable-id flow (no session to bind an org from)
  const json = await req.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Public self-enrolment endpoint — no auth gate. Rate-limit per IP to
  // keep an attacker (or a buggy script) from filling the approval queue
  // with junk riders. 10 successful onboarding posts per hour per IP is
  // generous for a normal household sharing one connection and tight
  // enough to make a spam run uneconomic.
  //
  // Counted AFTER validation on purpose: when it ran first, a parent
  // correcting a mistyped phone number three times burned three of her ten
  // slots on submissions that never created anything, and the bare
  // "RATE_LIMITED" string was rendered to her with no explanation.
  const rl = checkRate(`onboarding:${clientFingerprint(req)}`, 10, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        retryAfterSec: rl.retryAfterSec,
        message:
          "Too many registrations have been submitted from this connection in the last hour. " +
          "Please wait a little while and try again, or call the centre to register by phone.",
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

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

  // Double-submit guard. Parents fill this on a phone on patchy mobile data;
  // when the response is slow they press Submit again. Without this the club
  // got two identical children in the approval queue with no duplicate flag,
  // approved both, and billed the family twice — and there is no way to void
  // an invoice once raised, so the second ₹3,000 had to be argued away by hand.
  //
  // Match on the natural key a resubmission shares (same centre, same child,
  // same phone) and only inside a short window, so a genuine sibling or a
  // re-registration months later is unaffected. Returns the ORIGINAL rider id
  // with a 200 so the wizard's success screen behaves identically.
  const DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;
  const existing = await prisma.rider.findFirst({
    where: {
      centreId: centre.id,
      mobile: d.mobile,
      dob: new Date(d.dob),
      firstName: { equals: d.firstName, mode: "insensitive" },
      lastName: { equals: d.lastName, mode: "insensitive" },
      createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    },
    select: { id: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return NextResponse.json({
      riderId: existing.id,
      status: existing.status,
      feesOn: await isFeatureEnabledForCentre(centre.id, "fee-collection"),
      duplicate: true,
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
      aadhaarNo: encryptPII(d.aadhaarNo || null),
      aadhaarLast4: last4(d.aadhaarNo || null),
      aadhaarDocUrl: d.aadhaarDocUrl || null,
      aadhaarBackDocUrl: d.aadhaarBackDocUrl || null,
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

  // Signal whether the centre takes rider payments — the wizard's
  // post-submit card adapts its "what happens next" copy from this so
  // applicants going through a no-fees centre aren't told to expect a
  // payment link that will never arrive.
  const feesOn = await isFeatureEnabledForCentre(centre.id, "fee-collection");

  return NextResponse.json({ riderId: rider.id, status: "pending_approval", feesOn });
}
