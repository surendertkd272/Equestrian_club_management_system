import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";

// PATCH /api/owner/tenants/[id]/stripe — link or unlink the tenant to a Stripe
// customer. Linking: paste a `cus_xxx` id (created externally in Stripe
// dashboard or via your own checkout flow). Unlinking: pass `null` to detach.
// Permission: tenant.edit_billing.
const schema = z
  .object({
    stripeCustomerId: z
      .string()
      .regex(/^cus_[A-Za-z0-9]+$/, "Stripe customer IDs look like cus_xxx")
      .nullable(),
  })
  .strict();

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.edit_billing");
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: { id: true, stripeCustomerId: true },
  });
  if (!before) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // If linking, refuse if that customer id is already attached to a different tenant.
  if (parsed.data.stripeCustomerId) {
    const dupe = await prisma.organisation.findFirst({
      where: {
        stripeCustomerId: parsed.data.stripeCustomerId,
        NOT: { id: before.id },
      },
      select: { id: true, slug: true },
    });
    if (dupe) {
      return NextResponse.json(
        { error: "CUSTOMER_ALREADY_LINKED", details: { orgSlug: dupe.slug } },
        { status: 409 },
      );
    }
  }

  await prisma.organisation.update({
    where: { id: before.id },
    data: { stripeCustomerId: parsed.data.stripeCustomerId },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: parsed.data.stripeCustomerId ? "owner.stripe_linked" : "owner.stripe_unlinked",
    orgId: before.id,
    before: { stripeCustomerId: before.stripeCustomerId },
    after: { stripeCustomerId: parsed.data.stripeCustomerId },
  });

  return NextResponse.json({ ok: true });
}
