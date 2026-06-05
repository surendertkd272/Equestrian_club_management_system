import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PlanBadge, StatusBadge } from "./badges";
import { getSystemStatus } from "@/lib/system-status";
import { StatTile } from "@/components/ui/stat-tile";

export const dynamic = "force-dynamic";

export default async function OwnerDashboardPage() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  const [orgs, centreCount, riderCount, userCount, billingEvents, paidThisMonth, dueOutstanding, signupsLast30d, recentInvoices] = await Promise.all([
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
  ]);

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
        <p className="text-sm text-slate-400">Platform-wide snapshot across all tenants.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tenants" value={orgs.length} />
        <Stat label="Centres" value={centreCount} />
        <Stat label="Riders" value={riderCount} />
        <Stat label="Users" value={userCount} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label={`Paid · ${now.toLocaleString("en-IN", { month: "short" })}`}
          value={`₹${(paidThisMonth._sum.total ?? 0).toLocaleString("en-IN")}`}
          sub={`${paidThisMonth._count} invoice${paidThisMonth._count === 1 ? "" : "s"}`}
        />
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
        <Panel title="By status">
          <BreakdownRow label="Active" count={byStatus.active ?? 0} tone="green" />
          <BreakdownRow label="Trial" count={byStatus.trial ?? 0} tone="blue" />
          <BreakdownRow label="Past due" count={byStatus.past_due ?? 0} tone="amber" />
          <BreakdownRow label="Suspended" count={byStatus.suspended ?? 0} tone="red" />
        </Panel>
        <Panel title="By plan">
          <BreakdownRow label="Starter" count={byPlan.starter ?? 0} tone="slate" />
          <BreakdownRow label="Pro" count={byPlan.pro ?? 0} tone="blue" />
          <BreakdownRow label="Enterprise" count={byPlan.enterprise ?? 0} tone="violet" />
        </Panel>
      </div>

      {billingEvents.length > 0 && (
        <Panel title="Tenants needing attention">
          <ul className="divide-y divide-slate-800">
            {billingEvents.map((e) => {
              const org = e.orgId ? billingOrgById.get(e.orgId) : null;
              if (!org) return null;
              const label = e.action === "owner.tenant_suspended" ? "Suspended" : "Moved to past_due";
              const tone =
                e.action === "owner.tenant_suspended"
                  ? "bg-rose-500/20 text-rose-300"
                  : "bg-amber-500/20 text-amber-300";
              return (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <Link
                      href={`/owner/tenants/${org.id}`}
                      className="font-medium text-slate-100 hover:underline"
                    >
                      {org.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-slate-500">{org.slug}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
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
        <Panel title="Recent SaaS invoices">
          <ul className="divide-y divide-slate-800">
            {recentInvoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex flex-col">
                  <Link href={`/owner/saas-invoices/${i.id}/print`} target="_blank" className="font-mono text-xs text-slate-200 hover:underline">
                    {i.number}
                  </Link>
                  <span className="text-xs text-slate-500">{i.org.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-100">₹{i.total.toLocaleString("en-IN")}</span>
                  <span className={`rounded px-2 py-0.5 ${i.status === "paid" ? "bg-emerald-500/20 text-emerald-300" : i.status === "due" ? "bg-amber-500/20 text-amber-300" : "bg-slate-500/20 text-slate-300"}`}>
                    {i.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-right">
            <Link href="/owner/saas-invoices" className="text-xs text-slate-300 hover:underline">
              See all invoices →
            </Link>
          </div>
        </Panel>
      )}

      <Panel title="Recent signups">
        {recent.length === 0 ? (
          <div className="text-sm text-slate-400">No tenants yet.</div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <Link href={`/owner/tenants/${o.id}`} className="font-medium text-slate-100 hover:underline">
                    {o.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-slate-500">{o.slug}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <PlanBadge plan={o.plan} />
                  <StatusBadge status={o.status} />
                  <span>{new Date(o.onboardedAt).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 text-right">
          <Link href="/owner/tenants" className="text-xs text-slate-300 hover:underline">
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
  return <StatTile variant="dark" label={label} value={value} sub={sub} tone={warn ? "amber" : "default"} />;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {children}
    </div>
  );
}

const TONE: Record<string, string> = {
  green: "bg-emerald-500/20 text-emerald-300",
  blue: "bg-sky-500/20 text-sky-300",
  amber: "bg-amber-500/20 text-amber-300",
  red: "bg-rose-500/20 text-rose-300",
  slate: "bg-slate-500/20 text-slate-300",
  violet: "bg-violet-500/20 text-violet-300",
};

function BreakdownRow({ label, count, tone }: { label: string; count: number; tone: keyof typeof TONE }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-slate-300">{label}</span>
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
    <Panel title="System health · last 24h">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Health
          label="Cron sweep"
          value={s.lastCronAt ? humanAge(s.cronAgeMin!) : "never"}
          sub={s.cronStale ? "stale — investigate" : "fresh"}
          tone={cronColor as any}
        />
        <Health label="Email errors" value={String(s.emailErrorCount24h)} tone={emailColor as any} />
        <Health label="SMS errors" value={String(s.smsErrorCount24h)} tone={smsColor as any} />
        <Health
          label="Failed logins"
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
    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
