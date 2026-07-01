import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Owner-side analytics: cohort retention + feature usage telemetry.
// We deliberately compute these lazily server-side; if the platform
// grows past ~500 tenants we'll need pre-materialised aggregates, but
// at this scale the queries below run in <100ms on Postgres + indexes.

export default async function OwnerInsightsPage() {
  // ── Cohort retention: orgs grouped by their signup month. For each
  // cohort, count how many are still "active" or "trial" today vs how
  // many landed in suspended/offboarding/cancelled territory. Goes
  // back 12 months from now.
  const cohortStart = new Date();
  cohortStart.setUTCDate(1);
  cohortStart.setUTCHours(0, 0, 0, 0);
  cohortStart.setUTCMonth(cohortStart.getUTCMonth() - 11);

  const orgs = await prisma.organisation.findMany({
    where: { createdAt: { gte: cohortStart } },
    select: { id: true, createdAt: true, status: true },
  });

  // Bucket by YYYY-MM signup month.
  const cohorts = new Map<string, { total: number; alive: number }>();
  for (const o of orgs) {
    const key = o.createdAt.toISOString().slice(0, 7);
    const slot = cohorts.get(key) ?? { total: 0, alive: 0 };
    slot.total++;
    if (["active", "trial", "past_due"].includes(o.status)) slot.alive++;
    cohorts.set(key, slot);
  }
  const cohortRows = Array.from(cohorts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      total: v.total,
      alive: v.alive,
      pct: v.total > 0 ? Math.round((v.alive / v.total) * 100) : 0,
    }));

  // ── Feature usage — heuristic via AuditLog action namespaces. The
  // audit table records every meaningful tenant action with an `action`
  // string like "lesson.allocations_set" or "horses.bulk_imported". We
  // group by the module prefix (everything before the first dot) and
  // count distinct days × distinct users in the last 30 days. That's
  // close enough to "DAU per module" without instrumenting every page.
  const dayAgo = new Date(Date.now() - 30 * 86400000);
  const audit = await prisma.auditLog.findMany({
    where: { at: { gte: dayAgo }, userId: { not: null } },
    select: { action: true, userId: true, at: true },
    take: 100000,
  });

  const moduleUse = new Map<string, { events: number; users: Set<string>; days: Set<string> }>();
  for (const row of audit) {
    const module = (row.action.split(".")[0] ?? "other").toLowerCase();
    if (!moduleUse.has(module)) moduleUse.set(module, { events: 0, users: new Set(), days: new Set() });
    const slot = moduleUse.get(module)!;
    slot.events++;
    if (row.userId) slot.users.add(row.userId);
    slot.days.add(row.at.toISOString().slice(0, 10));
  }
  const moduleRows = Array.from(moduleUse.entries())
    .map(([key, v]) => ({ key, events: v.events, users: v.users.size, days: v.days.size }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 20);

  return (
    <div className="space-y-6 text-foreground">
      <div>
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="text-sm text-muted-foreground">
          Cohort retention + module usage. Both are computed live from the audit log — accurate, but
          re-run on every page load. Move to materialised aggregates if it gets slow.
        </p>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Cohort Retention (Last 12 Months)</CardTitle>
          <CardDescription className="text-muted-foreground">
            Tenants signed up in month X — % still in active/trial/past_due today.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cohortRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No signups yet.</p>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-2">Signup Month</th>
                  <th className="pb-2 text-right">Signed Up</th>
                  <th className="pb-2 text-right">Still Alive</th>
                  <th className="pb-2 text-right">Retention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cohortRows.map((r) => (
                  <tr key={r.month}>
                    <td className="py-2 font-mono text-xs">{r.month}</td>
                    <td className="py-2 text-right">{r.total}</td>
                    <td className="py-2 text-right">{r.alive}</td>
                    <td className="py-2 text-right">
                      <span className={`rounded px-2 py-0.5 text-xs ${r.pct >= 80 ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" : r.pct >= 50 ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300" : "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300"}`}>
                        {r.pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Module Usage · Last 30 Days</CardTitle>
          <CardDescription className="text-muted-foreground">
            Audit-log events grouped by module. "Days active" = distinct calendar days with any
            event in the module; "Users" = distinct users who triggered events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {moduleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit-log activity in the last 30 days.</p>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-2">Module</th>
                  <th className="pb-2 text-right">Events</th>
                  <th className="pb-2 text-right">Users</th>
                  <th className="pb-2 text-right">Days Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {moduleRows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-2 font-mono text-xs">{r.key}</td>
                    <td className="py-2 text-right">{r.events.toLocaleString()}</td>
                    <td className="py-2 text-right">{r.users}</td>
                    <td className="py-2 text-right">{r.days}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
