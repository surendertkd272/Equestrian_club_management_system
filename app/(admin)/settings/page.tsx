import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getOrgIdForSession } from "@/lib/features-gate";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_SUPPORT_EMAIL } from "@/lib/contact";
import { PublicContactForm } from "./form";
import { Badge } from "@/components/ui/badge";
import { FEATURES } from "@/lib/features";
import { getFeaturesForSession } from "@/lib/features-gate";

export const dynamic = "force-dynamic";

// Org-level settings the two HQ roles manage themselves. Today: the public
// contact details shown to users on the Help Center + portals.
export default async function SettingsPage() {
  const session = await requireSession();
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const org = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: { supportEmail: true, supportPhone: true },
  });

  // Which modules are actually on for this club.
  //
  // Nothing showed this anywhere on the tenant side, so the only way to answer
  // "is rider billing switched off for us?" was to open the owner portal —
  // which most people who need the answer cannot reach. Read-only here on
  // purpose: turning a module on or off is a commercial decision that stays
  // with the owner, but not being able to SEE it turns a deliberate setting
  // into a mystery.
  const enabled = await getFeaturesForSession(session);
  const GROUP_ORDER = ["operations", "people", "facility", "finance", "productivity", "advanced"] as const;
  const GROUP_LABELS: Record<string, string> = {
    operations: "Operations",
    people: "People",
    facility: "Facility",
    finance: "Finance",
    productivity: "Productivity",
    advanced: "Advanced",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Modules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            What is switched on for your club. To change any of these, contact your platform
            administrator — they are set per club as part of your plan.
          </p>
          {GROUP_ORDER.map((group) => {
            const rows = FEATURES.filter((f) => f.group === group);
            if (rows.length === 0) return null;
            return (
              <div key={group}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {GROUP_LABELS[group] ?? group}
                </h3>
                <ul className="divide-y text-sm">
                  {rows.map((f) => {
                    const on = enabled.has(f.key);
                    return (
                      <li key={f.key} className="flex items-start justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <div className="font-medium">{f.label}</div>
                          {/* The description matters most when a module is OFF
                              — it is the answer to "then why am I still seeing
                              X?", which is exactly what sends people looking. */}
                          <p className="text-xs text-muted-foreground">{f.description}</p>
                        </div>
                        <Badge variant={on ? "success" : "outline"} className="shrink-0">
                          {on ? "On" : "Off"}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Public Contact</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Shown to riders, parents, and staff on the Help Center and portals whenever they need
            to reach you. Leave the email blank to use the default ({DEFAULT_SUPPORT_EMAIL}).
          </p>
          <PublicContactForm
            initial={{
              supportEmail: org?.supportEmail ?? "",
              supportPhone: org?.supportPhone ?? "",
            }}
            defaultEmail={DEFAULT_SUPPORT_EMAIL}
          />
        </CardContent>
      </Card>
    </div>
  );
}
