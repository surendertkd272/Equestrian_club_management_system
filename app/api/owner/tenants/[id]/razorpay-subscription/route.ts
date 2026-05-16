import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";
import { createSubscription, cancelSubscription, isConfigured } from "@/lib/razorpay";
import { isPlanKey } from "@/lib/plans";
import { resolveRazorpayPlanId } from "@/lib/pricing";
import { sendEmail, renderEmail } from "@/lib/email";

// POST /api/owner/tenants/[id]/razorpay-subscription
//
// Mints a Razorpay Subscription on the tenant's current plan, stores the
// id back on Organisation, and emails the billing contact the mandate
// authorisation link. The mandate auth itself is handled by the customer
// on Razorpay's checkout page; once they complete it the webhook flips
// razorpaySubscriptionStatus to "authenticated" then "active".
//
// Refuses if there's already a non-cancelled subscription on the org —
// cancel the old one first via DELETE on this same endpoint.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.edit_billing");
  if (block) return block;
  if (!isConfigured()) return NextResponse.json({ error: "RAZORPAY_NOT_CONFIGURED" }, { status: 503 });

  const org = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      plan: true,
      billingEmail: true,
      razorpaySubscriptionId: true,
      razorpaySubscriptionStatus: true,
    },
  });
  if (!org) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!isPlanKey(org.plan)) return NextResponse.json({ error: "INVALID_PLAN" }, { status: 400 });
  const planId = await resolveRazorpayPlanId(org.plan, "monthly");
  if (!planId) {
    return NextResponse.json(
      {
        error: "PLAN_ID_NOT_CONFIGURED",
        message: `Set the Razorpay plan id for "${org.plan}" via /owner/pricing or env var RAZORPAY_PLAN_${org.plan.toUpperCase()}.`,
      },
      { status: 409 },
    );
  }
  if (org.razorpaySubscriptionId && org.razorpaySubscriptionStatus && !["cancelled", "completed", "expired"].includes(org.razorpaySubscriptionStatus)) {
    return NextResponse.json(
      { error: "SUBSCRIPTION_EXISTS", razorpaySubscriptionId: org.razorpaySubscriptionId, status: org.razorpaySubscriptionStatus },
      { status: 409 },
    );
  }

  let sub;
  try {
    sub = await createSubscription({
      plan: org.plan,
      planId,
      notes: { orgId: org.id, orgName: org.name },
    });
  } catch (err) {
    return NextResponse.json({ error: "PROVIDER_ERROR", message: (err as Error).message }, { status: 502 });
  }

  await prisma.organisation.update({
    where: { id: org.id },
    data: { razorpaySubscriptionId: sub.id, razorpaySubscriptionStatus: sub.status },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.razorpay_subscription_created",
    orgId: org.id,
    after: { subscriptionId: sub.id, status: sub.status, plan: org.plan },
  });

  // Send the mandate auth link to the tenant's billing email. They must
  // click it to authorise the recurring charge; until they do, no money
  // moves and no SaasInvoice is issued.
  if (org.billingEmail && sub.short_url) {
    await sendEmail({
      to: org.billingEmail,
      subject: `Authorise your Equiwings subscription · ${org.name}`,
      html: renderEmail({
        centreName: "Equiwings",
        heading: "Authorise the auto-pay mandate",
        body: `<p>We've prepared your <strong>${org.plan}</strong> plan subscription. To start, please authorise the auto-pay mandate using the secure Razorpay link below — this is a one-time setup.</p>
<p><a href="${sub.short_url}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none">Authorise mandate</a></p>
<p style="font-size:12px;color:#666">After authorisation, your card / UPI will be charged automatically each billing cycle. You can cancel from within the Equiwings dashboard at any time.</p>
<p style="font-size:12px;color:#666">If the button doesn't open, paste this URL: <code>${sub.short_url}</code></p>`,
      }),
      ref: { type: "razorpay.subscription_auth", rowId: org.id },
    });
  }

  return NextResponse.json({
    ok: true,
    subscriptionId: sub.id,
    status: sub.status,
    shortUrl: sub.short_url ?? null,
  });
}

// DELETE /api/owner/tenants/[id]/razorpay-subscription?atCycleEnd=1 — cancel
// the active subscription. cancelAtCycleEnd=1 lets the current paid period
// run out (kinder UX); default cancels immediately.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.edit_billing");
  if (block) return block;

  const org = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: { id: true, razorpaySubscriptionId: true },
  });
  if (!org?.razorpaySubscriptionId) return NextResponse.json({ error: "NO_SUBSCRIPTION" }, { status: 404 });

  const atCycleEnd = new URL(req.url).searchParams.get("atCycleEnd") === "1";
  try {
    const sub = await cancelSubscription(org.razorpaySubscriptionId, atCycleEnd);
    await prisma.organisation.update({
      where: { id: org.id },
      data: { razorpaySubscriptionStatus: sub.status },
    });
    await auditOwner({
      actorId: session.ownerId,
      action: "owner.razorpay_subscription_cancelled",
      orgId: org.id,
      after: { atCycleEnd, status: sub.status },
    });
    return NextResponse.json({ ok: true, status: sub.status });
  } catch (err) {
    return NextResponse.json({ error: "PROVIDER_ERROR", message: (err as Error).message }, { status: 502 });
  }
}
