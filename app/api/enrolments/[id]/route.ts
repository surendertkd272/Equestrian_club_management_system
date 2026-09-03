// Approve or reject a self-enrolled rider. Approval flips the rider from
// pending_approval → pending_payment and creates the registration invoice
// (the same invoice the onboarding flow used to create up-front). Rejection
// flips to "rejected". Permission: SUPER_ADMIN, ADMIN, CENTRE_MANAGER,
// SCHOOL_ADMINISTRATOR.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { sendEmail, renderEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import { isFeatureEnabledForCentre } from "@/lib/features-gate";
import { z } from "zod";
import { centreTracksDues, centreCanContactAboutMoney } from "@/lib/money-contact";

const APPROVER_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "SCHOOL_ADMINISTRATOR"]);

const schema = z.object({
  // "verify" records that a human opened this rider's documents and checked
  // them. "unverify" undoes that, for when a second look changes the answer.
  action: z.enum(["verify", "unverify", "approve", "reject"]),
  reason: z.string().max(300).optional(),
  note: z.string().max(300).optional(),
});

// Who may attest to documents. Deliberately excludes SCHOOL_ADMINISTRATOR:
// they sit in APPROVER_ROLES for visibility but are a read-only partner
// account, and vouching for a rider's Aadhaar is not a read.
const VERIFIER_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!APPROVER_ROLES.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const rider = await prisma.rider.findUnique({ where: { id: params.id } });
  if (!rider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Centre-scoped approvers can only act on their own club.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  // isHQ alone let an HQ caller of ANY organisation through. centreFence
  // keeps the centre rule and adds the org rule HQ never had.
  const fence = await centreFence(session, rider.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }
  // Only approve/reject need a pending enrolment. Verification does NOT:
  // riders added by bulk import are created active and never sit in
  // pending_approval, yet checking their signed indemnity is exactly the case
  // this exists for. Gating verify on the enrolment status would have made it
  // unreachable for the majority of a club's roster.
  const decidesEnrolment =
    parsed.data.action === "approve" || parsed.data.action === "reject";
  if (decidesEnrolment && rider.status !== "pending_approval") {
    return NextResponse.json({ error: "NOT_PENDING_APPROVAL", current: rider.status }, { status: 409 });
  }

  if (parsed.data.action === "verify" || parsed.data.action === "unverify") {
    if (!VERIFIER_ROLES.has(session.role)) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Only HQ or the centre manager can verify documents." },
        { status: 403 },
      );
    }
    const verifying = parsed.data.action === "verify";
    await prisma.rider.update({
      where: { id: rider.id },
      data: verifying
        ? {
            verifiedAt: new Date(),
            verifiedByUserId: session.userId,
            verifyNote: parsed.data.note || null,
          }
        : { verifiedAt: null, verifiedByUserId: null, verifyNote: null },
    });
    await audit({
      userId: session.userId,
      action: verifying ? "enrolment.verify" : "enrolment.unverify",
      tableName: "rider",
      rowId: rider.id,
      after: { name: `${rider.firstName} ${rider.lastName}`, note: parsed.data.note ?? null },
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true, verified: verifying });
  }

  // Approval requires a prior document check. Without this the verify button
  // would be decorative — anyone could skip straight to Approve and the
  // attestation would mean nothing.
  if (parsed.data.action === "approve" && !rider.verifiedAt) {
    return NextResponse.json(
      {
        error: "NOT_VERIFIED",
        message: "Check this rider's documents and mark them verified before approving.",
      },
      { status: 409 },
    );
  }

  if (parsed.data.action === "reject") {
    await prisma.rider.update({
      where: { id: rider.id },
      data: { status: "rejected", approvedByUserId: session.userId, approvedAt: new Date() },
    });
    await audit({
      userId: session.userId,
      action: "enrolment.reject",
      tableName: "rider",
      rowId: rider.id,
      before: { status: "pending_approval" },
      after: { status: "rejected", reason: parsed.data.reason ?? null },
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Approve. Two paths depending on the centre's fee-collection flag:
  //   ON  → create the registration invoice + move to pending_payment
  //         (the historical flow; parent gets paylink email/SMS/WA).
  //   OFF → skip invoice, set registrationPaid=true + status=active
  //         (no paylink notification, just a simple approval confirmation).
  // Whether a DUE is raised — not whether the family is told about it. A club
  // tracking dues internally still gets an invoice on the ledger; the parent
  // simply never sees or hears about it (lib/money-contact.ts).
  const feesOn = await centreTracksDues(rider.centreId);

  const centre = await prisma.centre.findUnique({
    where: { id: rider.centreId },
    select: { name: true },
  });
  const centreName = centre?.name ?? "Equiwings";
  // Fall back to the guardian's details captured in the DPDPA consent step.
  // Most riders here are children who have no email address of their own, so
  // `rider.email` alone was routinely null: the approval and the payment link
  // were generated, logged as sent, and delivered to nobody — the family just
  // never heard back, and the club had no idea.
  const consent = (rider.parentalConsentJson ?? null) as { parentPhone?: string; parentEmail?: string } | null;
  const parentPhone =
    rider.fatherPhone ?? rider.motherPhone ?? consent?.parentPhone ?? rider.mobile;
  const parentEmail = rider.email || consent?.parentEmail || null;
  const riderFullName = `${rider.firstName} ${rider.lastName}`;

  if (!feesOn) {
    // No-invoice approval — rider goes straight to active.
    await prisma.rider.update({
      where: { id: rider.id },
      data: {
        status: "active",
        registrationPaid: true,
        approvedByUserId: session.userId,
        approvedAt: new Date(),
      },
    });
    await audit({
      userId: session.userId,
      action: "enrolment.approve",
      tableName: "rider",
      rowId: rider.id,
      before: { status: "pending_approval" },
      after: { status: "active", feesDisabled: true },
    });
    // Welcome-only notification — no amount, no pay link.
    if (parentPhone) {
      await sendSms({
        to: parentPhone,
        body: `${centreName}: ${riderFullName}'s registration is approved. They're now active on the roster.`,
        ref: { type: "enrolment.approved", rowId: rider.id, payload: { riderId: rider.id, fees: "off" } },
      });
    }
    if (parentEmail) {
      await sendEmail({
        to: parentEmail,
        subject: `${riderFullName} is now active at ${centreName}`,
        html: renderEmail({
          centreName,
          heading: `Welcome to ${centreName}!`,
          body: `<p>Dear Parent / Guardian,</p>
<p>The registration for <b>${riderFullName}</b> has been approved by the centre team. The rider is now active on the roster — no further steps needed.</p>
<p>Your centre coordinator will be in touch with batch + schedule details.</p>`,
        }),
        ref: { type: "enrolment.approved", rowId: rider.id, payload: { riderId: rider.id, fees: "off" } },
      });
    }
    return NextResponse.json({ ok: true, status: "active", feesDisabled: true });
  }

  // Fees ON — original flow.
  const regPlan = await prisma.feePlan.findFirst({ where: { centreId: rider.centreId } });
  const regAmount = regPlan?.registrationAmount ?? 3000;

  const invoice = await prisma.$transaction(async (tx) => {
    // Approve → the rider is ACTIVE and usable across the app immediately
    // (attendance, lessons, progress). The registration fee is still tracked
    // via the "due" invoice below + the registrationPaid flag (flipped on
    // payment) — payment is NOT a gate on being an enrolled, attending rider.
    await tx.rider.update({
      where: { id: rider.id },
      data: { status: "active", approvedByUserId: session.userId, approvedAt: new Date() },
    });
    return tx.invoice.create({
      data: {
        centreId: rider.centreId,
        riderId: rider.id,
        amount: regAmount,
        gstAmount: 0,
        dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        kind: "registration",
        status: "due",
      },
    });
  });

  await audit({
    userId: session.userId,
    action: "enrolment.approve",
    tableName: "rider",
    rowId: rider.id,
    before: { status: "pending_approval" },
    after: { status: "active", invoiceId: invoice.id, regAmount },
  });

  // Notify the parent that the rider was approved + give them the
  // payment link. SMS + WhatsApp for quick attention; email for the
  // formal receipt-style detail. All three are fire-and-forget at this
  // call site — failures land in NotificationDispatchLog, the approve
  // itself stays successful (which is what the admin cares about).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const payUrl = `${baseUrl}/pay/${invoice.id}`;
  const amountLabel = `₹${regAmount.toLocaleString("en-IN")}`;

  // THE SILENCE GATE.
  //
  // A club can track what riders owe purely for its own books, with the family
  // never told. An invoice exists above; this decides whether anyone hears
  // about it. Without this, switching dues tracking on would have texted every
  // approved rider's parent a payment link for a bill the club never intended
  // to send — the precise thing the internal mode promises not to do.
  //
  // Asked as "may we contact this family about money", not "is billing on",
  // so the next person adding a channel here answers a question about the
  // parent rather than remembering which flag governs their code.
  const mayContact = await centreCanContactAboutMoney(rider.centreId);
  if (!mayContact) {
    await audit({
      userId: session.userId,
      action: "enrolment.approve_silent",
      tableName: "rider",
      rowId: rider.id,
      after: { invoiceId: invoice.id, regAmount, notified: false, reason: "dues tracked internally" },
    });
    return NextResponse.json({ ok: true, status: "pending_payment", invoiceId: invoice.id, notified: false });
  }

  if (parentPhone) {
    await sendSms({
      to: parentPhone,
      // 160-char budget: 'Equiwings: <Rider>'s registration at <centre> is approved.
      // Pay <amount> to activate: <url>. Reply STOP to opt out.' — fits even
      // long centre names because we trim where needed.
      body: `${centreName}: ${riderFullName}'s registration is approved. Pay ${amountLabel} to activate: ${payUrl}`,
      ref: { type: "enrolment.approved", rowId: invoice.id, payload: { riderId: rider.id } },
    });
    await sendWhatsApp({
      to: parentPhone,
      centreId: rider.centreId,
      template: {
        // Pre-approved Meta template — see DEPLOYMENT.md template list.
        // Body params: {rider name}, {amount}, {pay URL}.
        name: "ew_enrolment_approved",
        bodyParams: [riderFullName, amountLabel, payUrl],
      },
      previewBody: `${riderFullName}: approved · pay ${amountLabel} → ${payUrl}`,
      ref: { type: "enrolment.approved", rowId: invoice.id, payload: { riderId: rider.id } },
    });
  }
  if (parentEmail) {
    await sendEmail({
      to: parentEmail,
      subject: `Approved — pay ${amountLabel} to activate ${riderFullName}'s registration`,
      html: renderEmail({
        centreName,
        heading: `Welcome to ${centreName}!`,
        body: `<p>Dear Parent / Guardian,</p>
<p>The registration for <b>${riderFullName}</b> has been approved by the centre team. One step remains — settle the registration fee to activate the account.</p>
<table style="margin:16px 0;border-collapse:collapse;">
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Amount</td><td style="padding:4px 0;font-weight:600;">${amountLabel}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Kind</td><td style="padding:4px 0;">Registration</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Invoice</td><td style="padding:4px 0;font-family:monospace;font-size:12px;">${invoice.id.slice(-10)}</td></tr>
</table>
<p style="margin:24px 0;">
  <a href="${payUrl}" style="display:inline-block;background:#177434;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
    Pay ${amountLabel} now
  </a>
</p>
<p>Payment is secured via Razorpay — UPI, card, or netbanking accepted. You'll receive a receipt by email immediately on success.</p>
<p style="color:#6b7280;font-size:12px;">If the button doesn't work, copy this link into your browser: <a href="${payUrl}">${payUrl}</a></p>`,
      }),
      ref: { type: "enrolment.approved", rowId: invoice.id, payload: { riderId: rider.id } },
    });
  }

  // The rider is set active above; reporting "pending_payment" (a status this
  // flow stopped writing) made callers and the UI disagree with the database.
  return NextResponse.json({ ok: true, status: "active", invoiceId: invoice.id, amount: regAmount, payUrl });
}
