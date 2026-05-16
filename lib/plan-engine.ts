// applyPlan() — change a tenant's plan and reseed OrgFeature to match the bundle.
// All in one transaction so plan and feature state stay coherent: if the centre
// cap check fails, nothing changes. Returns a structured error string instead
// of throwing for the few expected failure modes the API needs to surface.

import { prisma } from "./prisma";
import { FEATURE_KEYS, type FeatureKey } from "./features";
import { PLAN_REGISTRY, planFeatures, type PlanKey } from "./plans";

export type ApplyPlanError = "ORG_NOT_FOUND" | "TOO_MANY_CENTRES" | "SAME_PLAN";

export type ApplyPlanResult =
  | { ok: true; before: PlanKey; after: PlanKey }
  | { ok: false; error: ApplyPlanError; details?: { centreCount?: number; maxCentres?: number } };

export async function applyPlan(
  orgId: string,
  newPlan: PlanKey,
  actorId?: string | null,
): Promise<ApplyPlanResult> {
  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: { id: true, plan: true, _count: { select: { centres: true } } },
  });
  if (!org) return { ok: false, error: "ORG_NOT_FOUND" };
  if (org.plan === newPlan) return { ok: false, error: "SAME_PLAN" };

  const maxCentres = PLAN_REGISTRY[newPlan].maxCentres;
  if (org._count.centres > maxCentres) {
    return {
      ok: false,
      error: "TOO_MANY_CENTRES",
      details: { centreCount: org._count.centres, maxCentres },
    };
  }

  const wanted = new Set<FeatureKey>(planFeatures(newPlan));
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.organisation.update({ where: { id: orgId }, data: { plan: newPlan } });
    // Rewrite every OrgFeature row to exactly match the new plan's bundle.
    // We upsert each feature key in the registry so that a feature key added
    // after onboarding still gets a row (defaults to disabled if not in bundle).
    for (const key of FEATURE_KEYS) {
      const enabled = wanted.has(key);
      await tx.orgFeature.upsert({
        where: { orgId_featureKey: { orgId, featureKey: key } },
        create: { orgId, featureKey: key, enabled, enabledAt: now, enabledBy: actorId ?? null },
        update: { enabled, enabledAt: now, enabledBy: actorId ?? null },
      });
    }
  });

  return { ok: true, before: org.plan as PlanKey, after: newPlan };
}
