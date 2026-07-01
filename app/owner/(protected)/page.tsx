import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PlanBadge, StatusBadge } from "./badges";
import { getSystemStatus } from "@/lib/system-status";
import { StatTile } from "@/components/ui/stat-tile";
import { ChartCard, HeroCard } from "@/components/dashboard/visuals";
import { Sparkline, MiniBars } from "@/components/ui/charts";
import { kpiIcon } from "@/lib/kpi-icon";
import { Building2, IndianRupee, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OwnerDashboardPage() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);
  // Six rolling month buckets (oldest → current) for the trend charts.
  const months = Array.from({ length: 6 }, (_, idx) => {
    const i = 5 - idx;
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    return { start, end, label: start.toLocaleString("en-IN", { month: "short" }) };
  });

  const [orgs, centreCount, riderCount, userCount, billingEvents, paidThisMonth, dueOutstanding, signupsLast30d, recentInvoices, saasPaid6] = await Promise.all([
    prisma.organisation.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        name: true,
        plan: true,
        status: true,
        createdAt: true,
        onboardedAt: true,
      },
    }),
    prisma.centre.count(),
    prisma.rider.count(),
    prisma.user.count(),
    // Latest billing-driven status transitions (emitted by the trial-end
    // sweep). Surfacing them here means the owner team doesn't have to
    // rely on the billing inbox to see which tenants are at risk.
    prisma.platformAuditLog.findMany({
      where: { action: { in: ["owner.tenant_past_due", "owner.tenant_suspended"] as any } },
      orderBy: { at: "desc" },
      take: 10,
      select: { id: true, action: true, orgId: true, at: true },
    }),
    // Revenue snapshot — paid this month, outstanding, signups in 30d.
    prisma.saasInvoice.aggregate({
      where: { status: "paid", paidAt: { gte: startOfMonth } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.saasInvoice.aggregate({
      where: { status: "due" },
      _sum: { total: true },
      _count: true,
    }),
    prisma.organisation.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.saasInvoice.findMany({
      orderBy: { issuedAt: "desc" },
      take: 5,
      include: { org: { select: { name: true } } },
    }),
    Promise.all(
      months.map((m) =>
        prisma.saasInvoice.aggregate({
          where: { status: "paid", paidAt: { gte: m.start, lt: m.end } },
          _sum: { total: true },
        }),
      ),
    ),
  ]);

  // SaaS revenue trend + cumulative tenant growth (growth derived from the
  // already-fetched org list — no extra query).
  const revenueSeries = saasPaid6.map((r) => Math.round(r._sum.total ?? 0));
  const tenantGrowth = months.map((m) => orgs.filter((o) => o.createdAt < m.end).length);

  const billingOrgIds = Array.from(new Set(billingEvents.map((e) => e.orgId).filter(Boolean) as string[]));
  const billingOrgs = billingOrgIds.length
    ? await prisma.organisation.findMany({
        where: { id: { in: billingOrgIds } },
        select: { id: true, name: true, slug: true, status: true },
      })
    : [];
  const billingOrgById = new Map(billingOrgs.map((o) => [o.id, o]));

  const byStatus = bucket(orgs, (o) => o.status);
  const byPlan = bucket(orgs, (o) => o.plan);
  const recent = orgs.slice(0, 5);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Platform-wide snapshot across all tenants.</p>
      </div>

      {/* Charted headline band. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroCard
          kicker="Platform"
          title={`${orgs.length} Tenants`}
          subtitle="across Equiwings Cloud"
          icon={<Building2 />}
          stats={[
            { label: "Centres", value: centreCount },
            { label: "Riders", value: riderCount },
            { label: "Users", value: userCount },
          ]}
          href="/owner/tenants"
          cta="View Tenants"
        />
        <ChartCard
          label={`Paid · ${now.toLocaleString("en-IN", { month: "short" })}`}
          value={`₹${(paidThisMonth._sum.total ?? 0).toLocaleString("en-IN")}`}
          sub={`${paidThisMonth._count} invoice${paidThisMonth._count === 1 ? "" : "s"} · 6-month trend`}
          icon={<IndianRupee className="h-5 w-5" />}
          chart={<MiniBars data={revenueSeries} />}
          link="/owner/saas-invoices"
        />
        <ChartCard
          label="Tenant Growth"
          value={orgs.length}
          sub={`${months[0].label}–${months[months.length - 1].label} cumulative`}
          icon={<Users className="h-5 w-5" />}
          chart={<Sparkline data={tenantGrowth} />}
          link="/owner/tenants"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat
          label="Outstanding"
          value={`₹${(dueOutstanding._sum.total ?? 0).toLocaleString("en-IN")}`}
          sub={`${dueOutstanding._count} due`}
          warn={(dueOutstanding._sum.total ?? 0) > 0}
        />
        <Stat
          label="Signups · 30d"
          value={String(signupsLast30d)}
          sub="new tenants"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="By Status">
          <BreakdownRow label="Active" count={byStatus.active ?? 0} tone="green" />
          <BreakdownRow label="Trial" count={byStatus.trial ?? 0} tone="blue" />
          <BreakdownRow label="Past Due" count={byStatus.past_due ?? 0} tone="amber" />
          <BreakdownRow label="Suspended" count={byStatus.suspended ?? 0} tone="red" />
        </Panel>
        <Panel title="By Plan">
          <BreakdownRow label="Starter" count={byPlan.starter ?? 0} tone="slate" />
          <BreakdownRow label="Pro" count={byPlan.pro ?? 0} tone="blue" />
          <BreakdownRow label="Enterprise" count={byPlan.enterprise ?? 0} tone="violet" />
        </Panel>
      </div>

      {billingEvents.length > 0 && (
        <Panel title="Tenants Needing Attention">
          <ul className="divide-y divide-border">
            {billingEvents.map((e) => {
              const org = e.orgId ? billingOrgById.get(e.orgId) : null;
              if (!org) return null;
              const label = e.action === "owner.tenant_suspended" ? "Suspended" : "Moved to past_due";
              const tone =
                e.action === "owner.tenant_suspended"
                  ? "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300"
                  : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300";
              return (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <Link
                      href={`/owner/tenants/${org.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {org.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{org.slug}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={`rounded px-2 py-0.5 ${tone}`}>{label}</span>
                    <span>{new Date(e.at).toLocaleString()}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <SystemStatusPanel />

      {recentInvoices.length > 0 && (
        <Panel title="Recent SaaS Invoices">
          <ul className="divide-y divide-border">
            {recentInvoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex flex-col">
                  <Link href={`/owner/saas-invoices/${i.id}/print`} target="_blank" className="font-mono text-xs text-foreground hover:underline">
                    {i.number}
                  </Link>
                  <span className="text-xs text-muted-foreground">{i.org.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-foreground">₹{i.total.toLocaleString("en-IN")}</span>
                  <span className={`rounded px-2 py-0.5 ${i.status === "paid" ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" : i.status === "due" ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300" : "bg-muted text-foreground"}`}>
                    {i.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-right">
            <Link href="/owner/saas-invoices" className="text-xs text-foreground hover:underline">
              See all invoices →
            </Link>
          </div>
        </Panel>
      )}

      <Panel title="Recent Signups">
        {recent.length === 0 ? (
          <div className="text-sm text-muted-foreground">No tenants yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <Link href={`/owner/tenants/${o.id}`} className="font-medium text-foreground hover:underline">
                    {o.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{o.slug}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PlanBadge plan={o.plan} />
                  <StatusBadge status={o.status} />
                  <span>{new Date(o.onboardedAt).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 text-right">
          <Link href="/owner/tenants" className="text-xs text-foreground hover:underline">
            See all tenants →
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function bucket<T>(items: T[], pick: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const key = pick(it);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function Stat({ label, value, sub, warn }: { label: string; value: number | string; sub?: string; warn?: boolean }) {
  return <StatTile label={label} value={value} sub={sub} tone={warn ? "amber" : "default"} icon={kpiIcon(label)} />;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

const TONE: Record<string, string> = {
  green: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  blue: "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300",
  amber: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300",
  red: "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300",
  slate: "bg-muted text-foreground",
  violet: "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300",
};

function BreakdownRow({ label, count, tone }: { label: string; count: number; tone: keyof typeof TONE }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-foreground">{label}</span>
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>{count}</span>
    </div>
  );
}

async function SystemStatusPanel() {
  const s = await getSystemStatus();
  const cronColor = s.cronStale ? "amber" : "green";
  const emailColor = s.emailErrorCount24h > 5 ? "red" : s.emailErrorCount24h > 0 ? "amber" : "green";
  const smsColor = s.smsErrorCount24h > 5 ? "red" : s.smsErrorCount24h > 0 ? "amber" : "green";
  return (
    <Panel title="System Health · Last 24h">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Health
          label="Cron Sweep"
          value={s.lastCronAt ? humanAge(s.cronAgeMin!) : "never"}
          sub={s.cronStale ? "stale — investigate" : "fresh"}
          tone={cronColor as any}
        />
        <Health label="Email Errors" value={String(s.emailErrorCount24h)} tone={emailColor as any} />
        <Health label="SMS Errors" value={String(s.smsErrorCount24h)} tone={smsColor as any} />
        <Health
          label="Failed Logins"
          value={String(s.failedLogins24h)}
          tone={s.failedLogins24h > 50 ? "amber" : "green"}
        />
      </div>
    </Panel>
  );
}

function humanAge(min: number): string {
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Health({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: keyof typeof TONE }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
