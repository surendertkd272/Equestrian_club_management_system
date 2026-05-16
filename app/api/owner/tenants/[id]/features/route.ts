import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { FEATURE_KEYS, isFeatureKey } from "@/lib/features";
import { isPlanKey, planAllowsOverrides } from "@/lib/plans";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";

const schema = z.object({
  featureKey: z.string().refine(isFeatureKey, "unknown feature"),
  enabled: z.boolean(),
});

// POST /api/owner/tenants/[id]/features — toggle a single feature.
// Only allowed when the tenant's plan permits overrides (Enterprise). On
// Starter/Pro, features are entirely plan-driven and this endpoint refuses
// with OVERRIDES_NOT_ALLOWED — the owner should change plan instead.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.toggle_features");
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const org = await prisma.organisation.findUnique({
    where: { id: params.id },
    select: { id: true, plan: true },
  });
  if (!org) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!isPlanKey(org.plan) || !planAllowsOverrides(org.plan)) {
    return NextResponse.json(
      { error: "OVERRIDES_NOT_ALLOWED", details: { plan: org.plan } },
      { status: 409 },
    );
  }

  // Sanity guard — keep FEATURE_KEYS authoritative (the zod refinement should
  // already have caught this, but defence in depth is cheap).
  if (!FEATURE_KEYS.includes(parsed.data.featureKey as (typeof FEATURE_KEYS)[number])) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }

  const before = await prisma.orgFeature.findUnique({
    where: { orgId_featureKey: { orgId: org.id, featureKey: parsed.data.featureKey } },
    select: { enabled: true },
  });
  const beforeEnabled = before?.enabled ?? false;

  await prisma.orgFeature.upsert({
    where: { orgId_featureKey: { orgId: org.id, featureKey: parsed.data.featureKey } },
    create: {
      orgId: org.id,
      featureKey: parsed.data.featureKey,
      enabled: parsed.data.enabled,
      enabledBy: session.ownerId,
    },
    update: { enabled: parsed.data.enabled, enabledBy: session.ownerId, enabledAt: new Date() },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.feature_toggled",
    orgId: org.id,
    before: { featureKey: parsed.data.featureKey, enabled: beforeEnabled },
    after: { featureKey: parsed.data.featureKey, enabled: parsed.data.enabled },
  });

  return NextResponse.json({ ok: true });
}
