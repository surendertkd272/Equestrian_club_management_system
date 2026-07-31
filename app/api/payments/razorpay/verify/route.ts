import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyCheckoutSignature, isConfigured } from "@/lib/razorpay";
import { audit } from "@/lib/audit";
import { notifyCentreManager } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { sendEmail, renderEmail } from "@/lib/email";
import { sendWhatsApp } from "@/lib/whatsapp";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { isFeatureEnabledForCentre } from "@/lib/features-gate";
import { bindRlsBypass } from "@/lib/tenant-context";

const schema = z.object({
  invoiceId: z.string().min(1),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export async function POST(req: NextRequest) {
  bindRlsBypass(); // public-by-unguessable-id flow (no session to bind an org from)
  // Rate-limit per IP. The HMAC signature check below is the actual auth,
  // but unbounded retries against a leaked order/payment id can still pin
  // a CPU core re-running verifyCheckoutSignature. 30 requests / minute /
  // IP is comfortably above a real user's needs (one redirect from
  // Razorpay) and tight enough to make a script worthless.
  const rl = await checkRate(`razorpay-verify:${clientFingerprint(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  if (!isConfigured()) {
    return NextResponse.json({ error: "RAZORPAY_NOT_CONFIGURED" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const ok = verifyCheckoutSignature(d.razorpay_order_id, d.razorpay_payment_id, d.razorpay_signature);
  if (!ok) {
    await audit({
      action: "razorpay.signature_invalid",
      tableName: "invoice",
      rowId: d.invoiceId,
      after: { orderId: d.razorpay_order_id, paymentId: d.razorpay_payment_id },
    });
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 403 });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: d.invoiceId },
    include: {
      centre: { select: { id: true, name: true } },
      rider: { select: { firstName: true, lastName: true, mobile: true, fatherPhone: true, motherPhone: true, email: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "INVOICE_NOT_FOUND" }, { status: 404 });

  // Fee-collection master switch — if the tenant flipped fees off while a
  // checkout was in flight, refuse to apply the payment. The Razorpay charge
  // still happened on Razorpay's side; the tenant will need to refund manually.
  // Logged so it's not silent.
  if (!(await isFeatureEnabledForCentre(invoice.centreId, "fee-collection"))) {
    await audit({
      action: "razorpay.verify_blocked_fees_off",
      tableName: "invoice",
      rowId: invoice.id,
      after: { orderId: d.razorpay_order_id, paymentId: d.razorpay_payment_id },
    });
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 503 });
  }

  // Idempotent fast-path: if the webhook beat us here, just return ok.
  const existing = await prisma.payment.findFirst({ where: { txnRef: d.razorpay_payment_id } });
  if (existing) return NextResponse.json({ ok: true, alreadyApplied: true });

  // Record only the OUTSTANDING balance (the order was minted for it), and flip
  // to paid only when cumulative payments cover amount+GST. Mirrors the webhook
  // so a prior partial/cash payment isn't double-counted and the parent isn't
  // over-charged. (The order route now charges outstanding, so `remaining`
  // equals the captured amount in the normal flow.)
  // Net of credit notes, matching what the order route charged. Face value
  // here would mark an invoice "due" that is actually settled, or bank more
  // than the club is owed.
  const creditAgg = await prisma.invoice.aggregate({
    where: { creditNoteForId: invoice.id },
    _sum: { amount: true, gstAmount: true },
  });
  const target =
    invoice.amount + invoice.gstAmount + (creditAgg._sum.amount ?? 0) + (creditAgg._sum.gstAmount ?? 0);
  const priorPaid = (await prisma.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } }))._sum.amount ?? 0;
  const remaining = Math.max(0, target - priorPaid);
  const fullyPaid = priorPaid + remaining >= target - 0.001;

  try {
    await prisma.$transaction([
      prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: remaining,
          method: "razorpay",
          txnRef: d.razorpay_payment_id,
          clearedAt: new Date(),
        },
      }),
      // If the invoice was voided AFTER the gateway order was created, the money
      // is still real — the family has been debited. Record it so it can be
      // refunded through the reversal path, but do NOT resurrect the cancelled
      // charge by flipping its status back.
      ...(invoice.voidedAt
        ? []
        : [prisma.invoice.update({ where: { id: invoice.id }, data: { status: fullyPaid ? "paid" : "due" } })]),
      ...(fullyPaid && !invoice.voidedAt && invoice.kind === "registration"
        ? [
            // Record the payment, but never resurrect a rider the club has
            // off-boarded: a departed family settling an old registration
            // invoice must not silently reappear on the roster. Withdrawal is
            // undone deliberately, on /riders.
            prisma.rider.updateMany({
              where: { id: invoice.riderId, status: { not: "withdrawn" } },
              data: { registrationPaid: true, status: "active" },
            }),
            prisma.rider.updateMany({
              where: { id: invoice.riderId, status: "withdrawn" },
              data: { registrationPaid: true },
            }),
          ]
        : []),
    ]);
  } catch (e: any) {
    // Race: the webhook inserted the same txnRef first → unique violation (P2002).
    if (e?.code === "P2002") return NextResponse.json({ ok: true, alreadyApplied: true });
    throw e;
  }

  await audit({
    action: "razorpay.payment_verified",
    tableName: "invoice",
    rowId: invoice.id,
    after: { orderId: d.razorpay_order_id, paymentId: d.razorpay_payment_id, amount: remaining },
  });

  await notifyCentreManager(invoice.centre.id, {
    type: "payment.received",
    title: `Payment received · ₹${Math.round(remaining).toLocaleString("en-IN")}`,
    body: `Invoice ${invoice.id.slice(-6)} (${invoice.kind.replace("_", " ")}) marked paid via Razorpay.`,
    link: `/riders/${invoice.riderId}`,
    payload: { invoiceId: invoice.id, paymentId: d.razorpay_payment_id },
  });

  // Parent SMS — payment confirmation.
  const parentPhone = invoice.rider.fatherPhone ?? invoice.rider.motherPhone ?? invoice.rider.mobile;
  if (parentPhone) {
    await sendSms({
      to: parentPhone,
      body: `${invoice.centre.name}: Thank you. ₹${Math.round(remaining).toLocaleString("en-IN")} ${invoice.kind.replace("_", " ")} fee for ${invoice.rider.firstName} received. Ref: ${d.razorpay_payment_id.slice(-8)}.`,
      ref: { type: "payment.received", rowId: invoice.id, payload: { paymentId: d.razorpay_payment_id } },
    });
    // Parent WhatsApp — pre-approved template `ew_payment_received`.
    await sendWhatsApp({
      to: parentPhone,
      centreId: invoice.centreId,
      template: {
        name: "ew_payment_received",
        bodyParams: [
          `${invoice.rider.firstName} ${invoice.rider.lastName}`,
          `₹${Math.round(remaining).toLocaleString("en-IN")}`,
          d.razorpay_payment_id.slice(-8),
        ],
      },
      previewBody: `Payment received · ₹${Math.round(remaining).toLocaleString("en-IN")} for ${invoice.rider.firstName}`,
      ref: { type: "payment.received", rowId: invoice.id, payload: { paymentId: d.razorpay_payment_id } },
    });
  }
  if (invoice.rider.email) {
    await sendEmail({
      to: invoice.rider.email,
      subject: `Payment receipt · ₹${Math.round(remaining).toLocaleString("en-IN")} · ${invoice.rider.firstName} ${invoice.rider.lastName}`,
      html: renderEmail({
        centreName: invoice.centre.name,
        heading: `Payment received — thank you`,
        body: `<p>Dear Parent / Guardian,</p>
<p>We've received your payment of <b>₹${Math.round(remaining).toLocaleString("en-IN")}</b> towards the <b>${invoice.kind.replace("_", " ")}</b> fee for <b>${invoice.rider.firstName} ${invoice.rider.lastName}</b>. This serves as your receipt.</p>
<table style="margin:16px 0;border-collapse:collapse;">
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Amount</td><td style="padding:4px 0;font-weight:600;">₹${Math.round(remaining).toLocaleString("en-IN")}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Method</td><td style="padding:4px 0;">Razorpay</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Payment ID</td><td style="padding:4px 0;font-family:monospace;font-size:12px;">${d.razorpay_payment_id}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Invoice</td><td style="padding:4px 0;font-family:monospace;font-size:12px;">${invoice.id}</td></tr>
</table>`,
      }),
      ref: { type: "payment.received", rowId: invoice.id, payload: { paymentId: d.razorpay_payment_id } },
    });
  }

  return NextResponse.json({ ok: true });
}
