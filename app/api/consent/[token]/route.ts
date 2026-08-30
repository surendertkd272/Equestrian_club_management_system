import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bindRlsBypass } from "@/lib/tenant-context";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { findLiveRequest, sendConsentReceipt } from "@/lib/rider-consent-request";
import {
  INDEMNITY_VERSION,
  INDEMNITY_TEXT,
  INJURY_NOC_VERSION,
  INJURY_NOC_TEXT,
} from "@/lib/schemas/rider-onboarding";

// Signing the indemnity + injury NOC from an emailed link.
//
// Public and unauthenticated: the token IS the authorisation, which is the
// only workable shape when the signer is a parent who has no account. The
// token is single-use, expiring, and stored hashed, so this is a narrower
// surface than it first looks — it can set consent on exactly one rider and
// does nothing else.
//
// The record written here is deliberately IDENTICAL in shape to the one the
// public registration wizard writes, including the pinned version strings, so
// a signature collected after the fact is the same legal artefact as one
// collected at registration. Anything less and the club has two tiers of
// consent and no way to tell them apart later.

const schema = z.object({
  fullNameSignature: z.string().trim().min(1, "Type a full name to sign").max(120),
  agreed: z.literal(true),
  injuryNocAgreed: z.literal(true),
  signerRelation: z.enum(["self", "parent", "guardian"]).default("self"),
});

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  // No session to derive an org from — the token identifies the rider.
  bindRlsBypass();

  const ip = clientFingerprint(req);
  // A token is unguessable, so this is about a broken client retrying in a
  // loop rather than about an attacker.
  const rate = await checkRate(`consent:ip:${ip}`, 20, 60 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSec: rate.retryAfterSec },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "Type your full name and tick both boxes to sign." },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const request = await findLiveRequest(params.token);
  if (!request) {
    return NextResponse.json(
      { error: "INVALID_LINK", message: "This link isn't valid. Ask the centre to send a new one." },
      { status: 404 },
    );
  }
  if (request.state === "already_signed") {
    // Not an error worth alarming anyone about — a parent clicking twice is
    // the likeliest cause.
    return NextResponse.json({ ok: true, alreadySigned: true });
  }
  if (request.state === "expired") {
    return NextResponse.json(
      { error: "EXPIRED", message: "This link has expired. Ask the centre to send a new one." },
      { status: 410 },
    );
  }

  const now = new Date();
  const ua = req.headers.get("user-agent");

  await prisma.$transaction(async (tx) => {
    await tx.rider.update({
      where: { id: request.riderId },
      data: {
        indemnitySignedAt: now,
        indemnitySignerIp: ip,
        indemnitySignerUa: ua,
        indemnityVersion: INDEMNITY_VERSION,
        indemnityConsentJson: {
          signature: d.fullNameSignature,
          signerRelation: d.signerRelation,
          indemnityVersion: INDEMNITY_VERSION,
          indemnityText: INDEMNITY_TEXT,
          nocVersion: INJURY_NOC_VERSION,
          nocText: INJURY_NOC_TEXT,
          nocAgreed: true,
          agreedAt: now.toISOString(),
          // Records HOW this was collected. A club looking at a signature two
          // years later should be able to tell it came from a post-import
          // request rather than the registration form.
          collectedVia: "consent_request",
        },
        // A fresh signature needs a fresh check — a staff member verified the
        // rider's paperwork before this existed, not this signature.
        verifiedAt: null,
        verifiedByUserId: null,
      },
    });
    await tx.riderConsentRequest.update({
      where: { id: request.id },
      data: { signedAt: now },
    });
  });

  // Their copy. Deliberately after the transaction and never awaited into the
  // failure path — the signature is already recorded, and losing the receipt is
  // a nuisance where failing the request would lose the consent itself.
  await sendConsentReceipt({
    to: request.email,
    riderName: `${request.rider.firstName} ${request.rider.lastName}`,
    centreName: request.centre.name,
    timeZone: request.centre.timezone,
    signature: d.fullNameSignature,
    signerRelation: d.signerRelation,
    signedAt: now,
    indemnityText: INDEMNITY_TEXT,
    indemnityVersion: INDEMNITY_VERSION,
    nocText: INJURY_NOC_TEXT,
    nocVersion: INJURY_NOC_VERSION,
  });

  await audit({
    action: "rider.consent_signed",
    tableName: "rider",
    rowId: request.riderId,
    after: {
      signature: d.fullNameSignature,
      relation: d.signerRelation,
      via: "consent_request",
      requestId: request.id,
    },
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}
