import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { PLAN_REGISTRY, type PlanKey } from "@/lib/plans";
import { FEATURES, type FeatureKey } from "@/lib/features";
import { getPublicPricing } from "@/lib/pricing";

export const metadata = {
  title: "Pricing · Equiwings",
  description: "Simple per-club pricing. 14-day free trial. INR + GST.",
};

// Pricing is dynamic — owners edit it from /owner/pricing without a
// redeploy. Pages render server-side so each visit picks up fresh data.
export const dynamic = "force-dynamic";

// Headline features displayed in the comparison block. Hand-curated so
// the table doesn't list all 29 keys.
const COMPARISON_KEYS: FeatureKey[] = [
  "attendance",
  "skill-tracking",
  "internal-exams",
  "certificates",
  "fee-collection",
  "parent-portal",
  "student-portal",
  "horse-management",
  "vet-records",
  "inventory",
  "expenses",
  "analytics",
  "whatsapp-notifications",
  "events",
  "external-exams",
  "accreditations",
  "hq-dashboard",
];

export default async function PricingPage() {
  const featureByKey = new Map(FEATURES.map((f) => [f.key, f]));
  const tiers = await getPublicPricing();

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-background">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="container mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold">Equiwings</Link>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline"><Link href="/login">Sign in</Link></Button>
            <Button asChild size="sm"><Link href="/signup">Start trial</Link></Button>
          </div>
        </div>
      </header>

      <section className="container mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold">Simple, club-scaled pricing.</h1>
          <p className="mt-3 text-muted-foreground">
            14-day free trial on every plan. No credit card required to start. GST charged extra at the prevailing 18%.
          </p>
        </div>

        <div className={`mt-12 grid gap-6 ${tiers.length === 3 ? "md:grid-cols-3" : tiers.length === 2 ? "md:grid-cols-2" : ""}`}>
          {tiers.map((t) => {
            const plan = PLAN_REGISTRY[t.key as PlanKey];
            if (!plan) return null;
            return (
              <div
                key={t.key}
                className={`relative rounded-2xl border bg-card p-6 shadow-sm ${t.highlight ? "ring-2 ring-amber-400" : ""}`}
              >
                {t.highlight && (
                  <div className="absolute -top-3 left-6 rounded-full bg-amber-400 px-3 py-0.5 text-xs font-semibold text-amber-900">
                    Most popular
                  </div>
                )}
                <div className="text-sm font-semibold uppercase tracking-wider text-amber-700">{t.label || plan.label}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">₹{t.annualInrPerMonth.toLocaleString("en-IN")}</span>
                  <span className="text-sm text-muted-foreground">/centre/month</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Billed annually · ₹{t.monthlyInr.toLocaleString("en-IN")} if monthly
                </div>
                <p className="mt-3 text-sm text-foreground">{t.tagline}</p>
                <div className="mt-4 text-xs text-muted-foreground">
                  Up to <strong>{Number.isFinite(plan.maxCentres) ? plan.maxCentres : "∞"}</strong> centres ·
                  {" "}<strong>{plan.features.length}</strong> modules
                </div>
                <Button asChild className="mt-5 w-full">
                  <Link href={`mailto:info@equiwings.com?subject=${t.label || plan.label}%20trial`}>
                    Start {t.label || plan.label} trial
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>

        {/* Comparison table */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold">What's in Each Plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Need a specific module not in your plan? Enterprise allows per-feature overrides.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-3 pr-4">Feature</th>
                  <th className="pb-3 pr-4 text-center">Starter</th>
                  <th className="pb-3 pr-4 text-center">Pro</th>
                  <th className="pb-3 pr-4 text-center">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {COMPARISON_KEYS.map((key) => {
                  const def = featureByKey.get(key);
                  if (!def) return null;
                  return (
                    <tr key={key}>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{def.label}</div>
                        <div className="text-xs text-muted-foreground">{def.description}</div>
                      </td>
                      {(["starter", "pro", "enterprise"] as PlanKey[]).map((p) => {
                        const has = (PLAN_REGISTRY[p].features as readonly FeatureKey[]).includes(key);
                        return (
                          <td key={p} className="py-3 pr-4 text-center">
                            {has ? <Check className="mx-auto h-5 w-5 text-emerald-600" /> : <X className="mx-auto h-5 w-5 text-muted-foreground/40" />}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-16 rounded-2xl border bg-muted/40 p-8">
          <h3 className="text-xl font-bold">Need something custom?</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Federation-level deployments, white-label branding, on-prem hosting, custom SLAs —
            we set them up case by case.
          </p>
          <Button asChild className="mt-4">
            <Link href="mailto:info@equiwings.com?subject=Enterprise%20discussion">Talk to sales</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t bg-card">
        <div className="container mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} Equiwings</div>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
