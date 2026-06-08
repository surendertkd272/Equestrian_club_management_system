import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditOwner } from "@/lib/owner-audit";
import {
  verifyStripeSignature,
  stripeWebhookSecret,
  orgStatusFromStripe,
} from "@/lib/stripe";
import { issueSaasInvoice } from "@/lib/saas-billing";
import { isPlanKey } from "@/lib/plans";

// POST /api/webhooks/stripe — server-to-server. Public route (no session),
// authenticated by the Stripe-Signature header against STRIPE_WEBHOOK_SECRET.
//
// Events we care about:
//   customer.subscription.created  — first time a tenant pays
//   customer.subscription.updated  — plan / status changes mid-flight
//   customer.subscription.deleted  — subscription cancelled
//   invoice.payment_failed         — flips us to past_due
//   invoice.payment_succeeded      — clears past_due back to active
//
// Anything else: 200 OK, no-op (Stripe expects 2xx within seconds; replying
// 400/500 makes them retry, which floods our logs).
export async function POST(req: NextRequest) {
  let payload: string;
  try {
    payload = await req.text();
  } catch {
    return NextResponse.json({ error: "BAD_BODY" }, { status: 400 });
  }

  const sig = req.headers.get("stripe-signature");
  let secret: string;
  try {
    secret = stripeWebhookSecret();
  } catch {
    // Env not configured — fail loudly so we don't silently accept unauth'd posts.
    return NextResponse.json({ error: "WEBHOOK_UNCONFIGURED" }, { status: 503 });
  }
  const verified = verifyStripeSignature(payload, sig, secret);
  if (!verified.ok) {
    return NextResponse.json({ error: "BAD_SIGNATURE", reason: verified.error }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }
  if (!event || typeof event.type !== "string" || !event.data?.object) {
    return NextResponse.json({ error: "BAD_EVENT" }, { status: 400 });
  }

  const result = await handleEvent(event);
  // Always 200 unless the body itself was malformed. Stripe will keep retrying
  // on non-2xx. Errors caught inside handleEvent become 200 + a flag so we
  // still log the issue but don't ask Stripe to thrash.
  return NextResponse.json({ ok: true, ...result });
}

async function handleEvent(event: { type: string; data: { object: any } }) {
  const obj = event.data.object;

  // Pull the customer id off whichever object this event carries.
  const customerId: string | undefined =
    typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
  if (!customerId) return { skipped: "no_customer" };

  const org = await prisma.organisation.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true, status: true, subscriptionStatus: true },
  });
  if (!org) return { skipped: "unknown_customer" };

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subStatus = event.type === "customer.subscription.deleted" ? "canceled" : obj.status;
      const newOrgStatus = orgStatusFromStripe(subStatus);
      const periodEndUnix: number | null = obj.current_period_end ?? null;
      await prisma.organisation.update({
        where: { id: org.id },
        data: {
          subscriptionStatus: subStatus ?? null,
          currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
          // Don't downgrade out of "trial" unless the new Stripe state explicitly
          // says we should; keeps the owner's manual "trial" tag intact when
          // Stripe reports "active" early.
          status: newOrgStatus,
          // Keep the overdue clock in sync: start it on first entry to past_due
          // (preserve it if already past_due), clear it when leaving past_due.
          pastDueSince:
            newOrgStatus === "past_due"
              ? org.status === "past_due"
                ? undefined
                : new Date()
              : null,
        },
      });
      await auditOwner({
        actorId: null,
        action: "owner.stripe_subscription_synced",
        orgId: org.id,
        before: { status: org.status, subscriptionStatus: org.subscriptionStatus },
        after: { status: newOrgStatus, subscriptionStatus: subStatus },
      });
      return { applied: event.type, newStatus: newOrgStatus };
    }

    case "invoice.payment_failed": {
      await prisma.organisation.update({
        where: { id: org.id },
        data: {
          status: "past_due",
          subscriptionStatus: "past_due",
          // Start the clock only on first entry to past_due; a re-delivered
          // payment_failed must not reset it.
          ...(org.status === "past_due" ? {} : { pastDueSince: new Date() }),
        },
      });
      await auditOwner({
        actorId: null,
        action: "owner.stripe_payment_failed",
        orgId: org.id,
        before: { status: org.status },
        after: { status: "past_due" },
      });
      return { applied: event.type, newStatus: "past_due" };
    }

    case "invoice.payment_succeeded": {
      // Issue our own SaaS invoice row + restore active status (if we were
      // past_due). Stripe sends amount_paid in the smallest currency unit
      // (paise for INR); period start/end are on the invoice's line items.
      // We rely on subscription_details.metadata.plan to know which tier
      // was billed — set this when creating the Stripe Price.
      const fullOrg = await prisma.organisation.findUnique({
        where: { id: org.id },
        select: { plan: true },
      });
      const planFromMeta = obj.subscription_details?.metadata?.plan ?? obj.lines?.data?.[0]?.metadata?.plan;
      const plan = isPlanKey(planFromMeta) ? planFromMeta : isPlanKey(fullOrg?.plan) ? fullOrg!.plan : "starter";
      const amountPaid = typeof obj.amount_paid === "number" ? obj.amount_paid : 0;
      // Stripe ships amount_paid in paise; SaasInvoice stores rupees.
      const subtotalRupees = Math.round(amountPaid / 100);
      const periodLine = obj.lines?.data?.[0]?.period;
      const periodStart = periodLine?.start ? new Date(periodLine.start * 1000) : new Date();
      const periodEnd = periodLine?.end ? new Date(periodLine.end * 1000) : new Date(Date.now() + 30 * 86400000);

      // Idempotency — Stripe re-delivers webhooks; refuse to issue twice
      // against the same invoice.id.
      const existing = await prisma.saasInvoice.findFirst({
        where: { externalRef: obj.id },
        select: { id: true },
      });
      if (!existing && subtotalRupees > 0) {
        try {
          await issueSaasInvoice({
            orgId: org.id,
            plan: plan as any,
            periodStart,
            periodEnd,
            // subtotal we record is pre-tax; Stripe's amount_paid is
            // post-tax, so we back-compute. If Stripe tax wasn't applied,
            // this just records the raw amount as subtotal.
            subtotal: subtotalRupees,
            externalRef: obj.id,
          });
        } catch (err) {
          console.error("[stripe] SaasInvoice issue failed", err);
        }
      }

      // Only un-suspend if we were past_due; don't override an owner-applied manual suspension.
      if (org.status === "past_due") {
        await prisma.organisation.update({
          where: { id: org.id },
          data: { status: "active", subscriptionStatus: "active", pastDueSince: null },
        });
        await auditOwner({
          actorId: null,
          action: "owner.stripe_payment_succeeded",
          orgId: org.id,
          before: { status: org.status },
          after: { status: "active" },
        });
        return { applied: event.type, newStatus: "active", invoiced: !existing };
      }
      return { applied: event.type, newStatus: org.status, invoiced: !existing };
    }

    default:
      return { ignored: event.type };
  }
}
