import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";
import { createBillingPortalSession } from "@/lib/stripe";

// POST /api/owner/tenants/[id]/billing-portal — mint a one-shot Stripe Customer
// Portal session URL for this tenant. The owner clicks "Manage Billing" on the
// detail page; we round-trip to Stripe, hand back the URL, the browser
// redirects. Permission: tenant.edit_billing (ADMIN + BILLING).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.edit_billing");
  if (block) return block;

  const org = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: { id: true, stripeCustomerId: true, slug: true },
  });
  if (!org) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!org.stripeCustomerId) {
    return NextResponse.json({ error: "NOT_LINKED" }, { status: 409 });
  }

  const returnUrl =
    process.env.STRIPE_BILLING_PORTAL_RETURN_URL ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/owner/tenants/${org.id}`;

  let portal: { url: string };
  try {
    portal = await createBillingPortalSession({
      customerId: org.stripeCustomerId,
      returnUrl,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "STRIPE_PORTAL_FAILED", details: (e as Error).message },
      { status: 502 },
    );
  }

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.billing_portal_opened",
    orgId: org.id,
    after: { customerId: org.stripeCustomerId },
  });

  return NextResponse.json({ url: portal.url });
}
