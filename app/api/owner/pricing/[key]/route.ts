import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";
import { PLANS } from "@/lib/plans";

const schema = z.object({
  label: z.string().min(1).max(40).optional(),
  tagline: z.string().min(1).max(160).optional(),
  monthlyInr: z.coerce.number().int().min(0).max(10_000_000).optional(),
  annualInrPerMonth: z.coerce.number().int().min(0).max(10_000_000).optional(),
  highlight: z.boolean().optional(),
  isVisible: z.boolean().optional(),
  razorpayPlanIdMonthly: z.string().max(60).optional().nullable(),
  razorpayPlanIdAnnual: z.string().max(60).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(100).optional(),
});

// PATCH /api/owner/pricing/[key] — update a single tier. Owners with
// the `tenant.edit_billing` perm (OWNER_ADMIN + OWNER_BILLING) can edit;
// OWNER_EDITOR cannot. Pricing changes hit the public page on the next
// request — there's no cache layer in between today.
export async function PATCH(req: NextRequest, { params }: { params: { key: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.edit_billing");
  if (block) return block;

  if (!(PLANS as readonly string[]).includes(params.key)) {
    return NextResponse.json({ error: "INVALID_PLAN_KEY" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.platformPricing.findUnique({ where: { key: params.key } });
  const updated = await prisma.platformPricing.upsert({
    where: { key: params.key },
    create: {
      key: params.key,
      // Required defaults if the row didn't exist yet — covers a manual
      // delete + re-insert flow.
      label: parsed.data.label ?? params.key,
      tagline: parsed.data.tagline ?? "",
      monthlyInr: parsed.data.monthlyInr ?? 0,
      annualInrPerMonth: parsed.data.annualInrPerMonth ?? 0,
      highlight: parsed.data.highlight ?? false,
      isVisible: parsed.data.isVisible ?? true,
      razorpayPlanIdMonthly: parsed.data.razorpayPlanIdMonthly ?? null,
      razorpayPlanIdAnnual: parsed.data.razorpayPlanIdAnnual ?? null,
      sortOrder: parsed.data.sortOrder ?? 0,
      updatedBy: session.ownerId,
    },
    update: {
      ...parsed.data,
      updatedBy: session.ownerId,
    },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.pricing_updated",
    before: before ?? undefined,
    after: updated,
  });

  return NextResponse.json({ ok: true, row: updated });
}
