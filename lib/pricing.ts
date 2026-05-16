// PlatformPricing accessors. The table holds exactly three rows
// (starter/pro/enterprise) — this module guarantees they exist + reads
// them in canonical sort order. The public /pricing page and the owner
// /owner/pricing page both go through here so there's one source of
// truth for the tier list shape.
//
// First-run seeding: when the table is empty, we insert the rows with
// placeholder amounts. The owner edits them via the UI. Numbers below
// are NOT a commercial commitment — they're starter defaults so the
// public page renders something coherent on day zero.

import { prisma } from "./prisma";
import { PLANS, type PlanKey } from "./plans";

const DEFAULTS: Array<{
  key: PlanKey;
  label: string;
  tagline: string;
  monthlyInr: number;
  annualInrPerMonth: number;
  highlight: boolean;
  sortOrder: number;
}> = [
  {
    key: "starter",
    label: "Starter",
    tagline: "Single-centre clubs running the core workflow.",
    monthlyInr: 2999,
    annualInrPerMonth: 2499,
    highlight: false,
    sortOrder: 1,
  },
  {
    key: "pro",
    label: "Pro",
    tagline: "Growing multi-centre academies with parents + vets.",
    monthlyInr: 5999,
    annualInrPerMonth: 4999,
    highlight: true,
    sortOrder: 2,
  },
  {
    key: "enterprise",
    label: "Enterprise",
    tagline: "Federation-level chains running competitions + HQ rollup.",
    monthlyInr: 11999,
    annualInrPerMonth: 9999,
    highlight: false,
    sortOrder: 3,
  },
];

// Make sure the three canonical rows exist. Idempotent — re-runs do
// nothing on a populated table. Returns the rows in sortOrder.
export async function ensurePricingRows() {
  const existing = await prisma.platformPricing.findMany({ select: { key: true } });
  const have = new Set(existing.map((e) => e.key));
  const missing = DEFAULTS.filter((d) => !have.has(d.key));
  if (missing.length > 0) {
    await prisma.platformPricing.createMany({
      data: missing.map((d) => ({
        key: d.key,
        label: d.label,
        tagline: d.tagline,
        monthlyInr: d.monthlyInr,
        annualInrPerMonth: d.annualInrPerMonth,
        highlight: d.highlight,
        sortOrder: d.sortOrder,
        isVisible: true,
      })),
    });
  }
  return prisma.platformPricing.findMany({ orderBy: { sortOrder: "asc" } });
}

// Visible tiers only, used by the public pricing page.
export async function getPublicPricing() {
  const all = await ensurePricingRows();
  return all.filter((r) => r.isVisible);
}

// Pick the Razorpay plan id for a given tier + cadence. DB wins;
// falls back to env vars (RAZORPAY_PLAN_STARTER etc.) so the existing
// pre-DB setup keeps working. Returns null when neither is configured.
export async function resolveRazorpayPlanId(
  plan: PlanKey,
  cadence: "monthly" | "annual" = "monthly",
): Promise<string | null> {
  if (!(PLANS as readonly string[]).includes(plan)) return null;
  const row = await prisma.platformPricing.findUnique({ where: { key: plan } });
  if (cadence === "monthly" && row?.razorpayPlanIdMonthly) return row.razorpayPlanIdMonthly;
  if (cadence === "annual" && row?.razorpayPlanIdAnnual) return row.razorpayPlanIdAnnual;
  const envKey = `RAZORPAY_PLAN_${plan.toUpperCase()}`;
  return process.env[envKey] || null;
}
