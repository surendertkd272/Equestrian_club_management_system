// Plan registry — maps each commercial plan to:
//   - features:       which feature keys it bundles
//   - maxCentres:     hard limit on centres per tenant (∞ via Infinity)
//   - allowOverrides: whether owners can flip individual features on/off
//                     outside the bundle (only Enterprise gets this)
//
// Changing a tenant's plan reseeds OrgFeature to exactly match the bundle here
// (see lib/plan-engine.ts). For Enterprise, an extra toggle endpoint can
// override a single feature; for Starter/Pro the plan is the whole story.

import type { FeatureKey } from "./features";

export const PLANS = ["starter", "pro", "enterprise"] as const;
export type PlanKey = (typeof PLANS)[number];

export type PlanDef = {
  key: PlanKey;
  label: string;
  features: readonly FeatureKey[];
  maxCentres: number;
  allowOverrides: boolean;
};

// Starter — single-centre clubs running the basics. No public portals,
// no advanced reporting.
const STARTER_FEATURES = [
  "attendance",
  "skill-tracking",
  "internal-exams",
  "certificates",
  "staff-attendance",
  "fee-collection",
  "tasks",
  "leave-requests",
] as const satisfies readonly FeatureKey[];

// Pro — multi-centre operators with parents/riders, horse roster, full
// inventory, and basic analytics.
const PRO_FEATURES = [
  ...STARTER_FEATURES,
  "parent-portal",
  "student-portal",
  "horse-management",
  "vet-records",
  "inventory",
  "consumables",
  "injuries",
  "whatsapp-notifications",
  "approvals",
  "expenses",
  "reports",
  "analytics",
  "accreditations",
  "events",
  "training-certs",
  "facility-bookings",
] as const satisfies readonly FeatureKey[];

// Enterprise — everything. External examiners,
// cross-centre HQ rollup.
const ENTERPRISE_FEATURES = [
  ...PRO_FEATURES,
  "external-exams",
  "teams",
  "farriery",
  "hq-dashboard",
] as const satisfies readonly FeatureKey[];

export const PLAN_REGISTRY: Record<PlanKey, PlanDef> = {
  starter: {
    key: "starter",
    label: "Starter",
    features: STARTER_FEATURES,
    maxCentres: 1,
    allowOverrides: false,
  },
  pro: {
    key: "pro",
    label: "Pro",
    features: PRO_FEATURES,
    maxCentres: 5,
    allowOverrides: false,
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise",
    features: ENTERPRISE_FEATURES,
    maxCentres: Number.POSITIVE_INFINITY,
    allowOverrides: true,
  },
};

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

export function planFeatures(plan: PlanKey): readonly FeatureKey[] {
  return PLAN_REGISTRY[plan].features;
}

export function planMaxCentres(plan: PlanKey): number {
  return PLAN_REGISTRY[plan].maxCentres;
}

export function planAllowsOverrides(plan: PlanKey): boolean {
  return PLAN_REGISTRY[plan].allowOverrides;
}
