import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { audit } from "@/lib/audit";
import { auditOwner } from "@/lib/owner-audit";
import { notifyCentreManager } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { sendEmail, renderEmail } from "@/lib/email";
import { sendWhatsApp } from "@/lib/whatsapp";
import { issueSaasInvoice } from "@/lib/saas-billing";
import { isPlanKey } from "@/lib/plans";
import { isFeatureEnabledForCentre } from "@/lib/features-gate";

// Razorpay → us. Configure in dashboard with HTTPS URL + secret matching RAZORPAY_WEBHOOK_SECRET.
// Idempotency is critical: Razorpay may retry; our verify endpoint may also have run.
export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-razorpay-signature");
  const rawBody = await req.text();

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 403 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  // SaaS subscription events: route them to the dedicated handler before the
  // tenant-payment branch, since they carry different payload shapes and
  // operate on Organisation (not Invoice).
  if (typeof event?.event === "string" && event.event.startsWith("subscription.")) {
    return await handleSubscriptionEvent(event);
  }

  // We only act on `payment.captured`. Other events (refund, dispute) are logged then ignored
  // until we have UI to surface them.
  if (event?.event !== "payment.captured") {
    await audit({
      action: `razorpay.webhook.${event?.event ?? "unknown"}`,
      tableName: "webhook",
      rowId: event?.payload?.payment?.entity?.id ?? "—",
      after: { event: event?.event, id: event?.payload?.payment?.entity?.id },
    });
    return NextResponse.json({ ok: true, skipped: event?.event });
  }

  const payment = event.payload?.payment?.entity;
  const invoiceId = payment?.notes?.invoiceId as string | undefined;
  const paymentId = payment?.id as string | undefined;
  const orderId = payment?.order_id as string | undefined;

  if (!invoiceId || !paymentId) {
    return NextResponse.json({ error: "MISSING_NOTES" }, { status: 400 });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      centre: { select: { id: true, name: true } },
      rider: { select: { firstName: true, lastName: true, mobile: true, fatherPhone: true, motherPhone: true, email: true } },
    },
  });
  if (!invoice) {
    return NextResponse.json({ error: "INVOICE_NOT_FOUND" }, { status: 404 });
  }

  // Fee-collection master switch — if the tenant turned fees off between
  // the user starting checkout and Razorpay's webhook landing here, log it
  // and no-op. Razorpay still captured the charge; tenant refunds manually.
  // Returning 200 with `skipped` so Razorpay doesn't retry indefinitely.
  if (!(await isFeatureEnabledForCentre(invoice.centreId, "fee-collection"))) {
    await audit({
      action: "razorpay.webhook.skipped_fees_off",
      tableName: "invoice",
      rowId: invoice.id,
      after: { orderId, paymentId, amountPaise: payment.amount },
    });
    return NextResponse.json({ ok: true, skipped: "fees_off" });
  }

  // Idempotent: fast-path if this payment id was already applied.
  const existing = await prisma.payment.findFirst({ where: { txnRef: paymentId } });
  if (existing) {
    return NextResponse.json({ ok: true, alreadyApplied: true });
  }

  // Use the ACTUAL captured amount (paise → rupees), and only mark the invoice
  // paid when cumulative payments cover amount + GST — a partial/short capture
  // must NOT flip an invoice to fully paid.
  const captured = (payment.amount as number) / 100;
  const target = invoice.amount + invoice.gstAmount;
  const priorPaid = (await prisma.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } }))._sum.amount ?? 0;
  const fullyPaid = priorPaid + captured >= target - 0.001;

  try {
    await prisma.$transaction([
      prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: captured,
          method: "razorpay",
          txnRef: paymentId,
          clearedAt: new Date(),
        },
      }),
      prisma.invoice.update({ where: { id: invoice.id }, data: { status: fullyPaid ? "paid" : "due" } }),
      // Activate the rider only once registration is FULLY paid.
      ...(fullyPaid && invoice.kind === "registration"
        ? [prisma.rider.update({ where: { id: invoice.riderId }, data: { registrationPaid: true, status: "active" } })]
        : []),
    ]);
  } catch (e: any) {
    // Race: the /verify redirect inserted the same txnRef first. The DB unique
    // constraint (P2002) makes this safe — treat as already-applied.
    if (e?.code === "P2002") return NextResponse.json({ ok: true, alreadyApplied: true });
    throw e;
  }

  await audit({
    action: "razorpay.webhook.payment_captured",
    tableName: "invoice",
    rowId: invoice.id,
    after: { orderId, paymentId, amountPaise: payment.amount },
  });

  await notifyCentreManager(invoice.centre.id, {
    type: "payment.received",
    title: `Payment received (webhook) · ₹${invoice.amount.toLocaleString("en-IN")}`,
    body: `Invoice ${invoice.id.slice(-6)} (${invoice.kind.replace("_", " ")}) marked paid via Razorpay webhook.`,
    link: `/riders/${invoice.riderId}`,
    payload: { invoiceId: invoice.id, paymentId },
  });

  // Parent SMS + email — same dispatch as /verify path. Idempotency comes from the Payment.txnRef
  // dedup higher up in this handler (if already applied, we early-return before reaching here).
  const parentPhone = invoice.rider.fatherPhone ?? invoice.rider.motherPhone ?? invoice.rider.mobile;
  if (parentPhone) {
    await sendSms({
      to: parentPhone,
      body: `${invoice.centre.name}: Thank you. ₹${invoice.amount.toLocaleString("en-IN")} ${invoice.kind.replace("_", " ")} fee for ${invoice.rider.firstName} received. Ref: ${paymentId.slice(-8)}.`,
      ref: { type: "payment.received", rowId: invoice.id, payload: { paymentId } },
    });
    await sendWhatsApp({
      to: parentPhone,
      centreId: invoice.centreId,
      template: {
        name: "ew_payment_received",
        bodyParams: [
          `${invoice.rider.firstName} ${invoice.rider.lastName}`,
          `₹${invoice.amount.toLocaleString("en-IN")}`,
          paymentId.slice(-8),
        ],
      },
      previewBody: `Payment received (webhook) · ₹${invoice.amount.toLocaleString("en-IN")}`,
      ref: { type: "payment.received", rowId: invoice.id, payload: { paymentId } },
    });
  }
  if (invoice.rider.email) {
    await sendEmail({
      to: invoice.rider.email,
      subject: `Payment receipt · ₹${invoice.amount.toLocaleString("en-IN")} · ${invoice.rider.firstName} ${invoice.rider.lastName}`,
      html: renderEmail({
        centreName: invoice.centre.name,
        heading: `Payment received — thank you`,
        body: `<p>Dear Parent / Guardian,</p>
<p>We've received your payment of <b>₹${invoice.amount.toLocaleString("en-IN")}</b> towards the <b>${invoice.kind.replace("_", " ")}</b> fee for <b>${invoice.rider.firstName} ${invoice.rider.lastName}</b>. This serves as your receipt.</p>
<table style="margin:16px 0;border-collapse:collapse;">
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Amount</td><td style="padding:4px 0;font-weight:600;">₹${invoice.amount.toLocaleString("en-IN")}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Method</td><td style="padding:4px 0;">Razorpay</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Payment ID</td><td style="padding:4px 0;font-family:monospace;font-size:12px;">${paymentId}</td></tr>
</table>`,
      }),
      ref: { type: "payment.received", rowId: invoice.id, payload: { paymentId } },
    });
  }

  return NextResponse.json({ ok: true });
}

// Razorpay sends these for SaaS-side subscriptions (the platform billing
// tenants for the product itself). We:
//   • subscription.charged: issue a SaasInvoice, mark org active.
//   • subscription.halted: payment failed past Razorpay's retry policy → past_due.
//   • subscription.cancelled / completed: subscription ended.
//   • subscription.authenticated / activated: mandate is live; nothing
//     to invoice yet (charged fires for the actual money movement).
// Idempotency: we key off the payment.id (or subscription.id when there's
// no payment object) so re-deliveries don't double-issue.
async function handleSubscriptionEvent(event: any) {
  const sub = event.payload?.subscription?.entity;
  const payment = event.payload?.payment?.entity;
  const subscriptionId = sub?.id as string | undefined;
  if (!subscriptionId) {
    return NextResponse.json({ ok: true, skipped: "no_subscription_id" });
  }
  const org = await prisma.organisation.findFirst({
    where: { razorpaySubscriptionId: subscriptionId },
    select: { id: true, plan: true, status: true },
  });
  if (!org) {
    await audit({
      action: `razorpay.webhook.${event.event}`,
      tableName: "webhook",
      rowId: subscriptionId,
      after: { event: event.event, unknownSubscription: subscriptionId },
    });
    return NextResponse.json({ ok: true, skipped: "unknown_subscription" });
  }

  switch (event.event) {
    case "subscription.charged": {
      const paymentId = payment?.id as string | undefined;
      const amountPaise = (payment?.amount as number) ?? 0;
      const subtotalRupees = Math.round(amountPaise / 100);

      // Idempotency — same payment delivered twice should not double-issue.
      if (paymentId) {
        const existing = await prisma.saasInvoice.findFirst({
          where: { externalRef: paymentId },
          select: { id: true },
        });
        if (existing) return NextResponse.json({ ok: true, alreadyApplied: true });
      }

      const plan = isPlanKey(org.plan) ? org.plan : "starter";
      const now = new Date();
      const periodStart = sub.current_start ? new Date(sub.current_start * 1000) : now;
      const periodEnd = sub.current_end ? new Date(sub.current_end * 1000) : new Date(now.getTime() + 30 * 86400000);

      if (subtotalRupees > 0) {
        try {
          await issueSaasInvoice({
            orgId: org.id,
            plan: plan as any,
            periodStart,
            periodEnd,
            subtotal: subtotalRupees,
            externalRef: paymentId ?? subscriptionId,
          });
        } catch (err) {
          console.error("[razorpay] SaasInvoice issue failed", err);
        }
      }

      // Restore active state if we were past_due.
      if (org.status === "past_due") {
        await prisma.organisation.update({
          where: { id: org.id },
          data: { status: "active", razorpaySubscriptionStatus: "active" },
        });
        await auditOwner({
          actorId: null,
          action: "owner.razorpay_payment_succeeded",
          orgId: org.id,
          before: { status: org.status },
          after: { status: "active" },
        });
      } else {
        await prisma.organisation.update({
          where: { id: org.id },
          data: { razorpaySubscriptionStatus: "active" },
        });
      }
      return NextResponse.json({ ok: true, invoiced: true });
    }

    case "subscription.halted":
    case "subscription.pending": {
      await prisma.organisation.update({
        where: { id: org.id },
        data: { status: "past_due", razorpaySubscriptionStatus: event.event === "subscription.halted" ? "halted" : "pending" },
      });
      await auditOwner({
        actorId: null,
        action: "owner.razorpay_payment_failed",
        orgId: org.id,
        before: { status: org.status },
        after: { status: "past_due", event: event.event },
      });
      return NextResponse.json({ ok: true });
    }

    case "subscription.cancelled":
    case "subscription.completed": {
      await prisma.organisation.update({
        where: { id: org.id },
        data: { razorpaySubscriptionStatus: event.event === "subscription.cancelled" ? "cancelled" : "completed" },
      });
      await auditOwner({
        actorId: null,
        action: `owner.razorpay_${event.event.replace("subscription.", "")}`,
        orgId: org.id,
      });
      return NextResponse.json({ ok: true });
    }

    case "subscription.authenticated":
    case "subscription.activated": {
      await prisma.organisation.update({
        where: { id: org.id },
        data: { razorpaySubscriptionStatus: event.event === "subscription.activated" ? "active" : "authenticated" },
      });
      return NextResponse.json({ ok: true });
    }

    default: {
      await audit({
        action: `razorpay.webhook.${event.event}`,
        tableName: "webhook",
        rowId: subscriptionId,
        after: { event: event.event, orgId: org.id },
      });
      return NextResponse.json({ ok: true, ignored: event.event });
    }
  }
}
