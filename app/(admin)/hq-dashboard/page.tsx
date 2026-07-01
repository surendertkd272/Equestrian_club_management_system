import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { StatTile } from "@/components/ui/stat-tile";
import { ChartCard, HeroCard } from "@/components/dashboard/visuals";
import { MiniBars, RingGauge } from "@/components/ui/charts";
import { kpiIcon } from "@/lib/kpi-icon";
import { Building2, Users } from "lucide-react";

export const dynamic = "force-dynamic";

// HQ Comparative Dashboard — side-by-side metrics for every centre under the
// signed-in super admin's organisation. Built for multi-club operators who
// want one screen to compare attendance, fees, pass rate, etc. across all
// their centres at once. HQ-tier only (SUPER_ADMIN + ADMIN).
export default async function HQDashboardPage() {
  const session = (await getSession())!;
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");
  // Window for "recent" metrics. Tweakable: 30 days feels right for
  // attendance, 90 for exam pass rate. The page is read-only so we don't
  // bother making these user-configurable yet.
  const now = new Date();
  const thirty = new Date(now.getTime() - 30 * 86400000);
  const ninety = new Date(now.getTime() - 90 * 86400000);

  const centres = await prisma.centre.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, address: true },
  });

  // Batched across ALL centres — ~7 queries total instead of 1 + 7×N (the old
  // per-centre fan-out). groupBy gives per-centre counts in one trip; the two
  // findMany pulls (attendance has no centreId column — it joins via batch —
  // and exams need pass-rate) are bucketed in JS below.
  const centreIds = centres.map((c) => c.id);
  const [riderGroups, staffGroups, horseGroups, unpaidGroups, certGroups, attendanceRows, examRows] = await Promise.all([
    prisma.rider.groupBy({ by: ["centreId"], where: { centreId: { in: centreIds }, status: "active" }, _count: true }),
    prisma.user.groupBy({ by: ["centreId"], where: { centreId: { in: centreIds }, status: "active" }, _count: true }),
    prisma.horse.groupBy({ by: ["centreId"], where: { centreId: { in: centreIds }, status: "active" }, _count: true }),
    prisma.invoice.groupBy({ by: ["centreId"], where: { centreId: { in: centreIds }, status: "due" }, _count: true }),
    prisma.certificate.groupBy({ by: ["centreId"], where: { centreId: { in: centreIds }, issuedAt: { gte: ninety } }, _count: true }),
    prisma.attendance.findMany({
      where: { batch: { centreId: { in: centreIds } }, date: { gte: thirty } },
      select: { status: true, batch: { select: { centreId: true } } },
    }),
    prisma.exam.findMany({
      where: { centreId: { in: centreIds }, status: "completed", updatedAt: { gte: ninety } },
      select: { centreId: true, passed: true },
    }),
  ]);

  const countMap = (gs: { centreId: string | null; _count: number }[]) =>
    new Map(gs.map((g) => [g.centreId, g._count]));
  const riderCount = countMap(riderGroups);
  const staffCount = countMap(staffGroups);
  const horseCount = countMap(horseGroups);
  const unpaidCount = countMap(unpaidGroups);
  const certCount = countMap(certGroups);

  const att = new Map<string, { present: number; total: number }>();
  for (const a of attendanceRows) {
    const cid = a.batch.centreId;
    const cur = att.get(cid) ?? { present: 0, total: 0 };
    cur.total += 1;
    if (a.status === "present" || a.status === "late") cur.present += 1;
    att.set(cid, cur);
  }
  const ex = new Map<string, { passed: number; total: number }>();
  for (const e of examRows) {
    const cur = ex.get(e.centreId) ?? { passed: 0, total: 0 };
    cur.total += 1;
    if (e.passed === true) cur.passed += 1;
    ex.set(e.centreId, cur);
  }

  const rows = centres.map((c) => {
    const a = att.get(c.id) ?? { present: 0, total: 0 };
    const e = ex.get(c.id) ?? { passed: 0, total: 0 };
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      address: c.address,
      activeRiders: riderCount.get(c.id) ?? 0,
      activeStaff: staffCount.get(c.id) ?? 0,
      horses: horseCount.get(c.id) ?? 0,
      attendancePct: a.total > 0 ? Math.round((a.present / a.total) * 100) : null,
      attendanceSampleSize: a.total,
      unpaidInvoices: unpaidCount.get(c.id) ?? 0,
      passRate: e.total > 0 ? Math.round((e.passed / e.total) * 100) : null,
      examsCompleted90: e.total,
      certs90: certCount.get(c.id) ?? 0,
    };
  });

  // Roll-up totals across the org. Useful as a sanity check + headline KPIs.
  const totals = {
    centres: rows.length,
    riders: rows.reduce((s, r) => s + r.activeRiders, 0),
    staff: rows.reduce((s, r) => s + r.activeStaff, 0),
    horses: rows.reduce((s, r) => s + r.horses, 0),
    unpaid: rows.reduce((s, r) => s + r.unpaidInvoices, 0),
    certs90: rows.reduce((s, r) => s + r.certs90, 0),
  };

  // Headline visuals: riders per centre + org-wide average attendance.
  const ridersByCentre = rows.map((r) => r.activeRiders);
  const attPcts = rows.map((r) => r.attendancePct).filter((p): p is number => p != null);
  const avgAttendance = attPcts.length ? Math.round(attPcts.reduce((s, p) => s + p, 0) / attPcts.length) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">HQ Comparative Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Side-by-side metrics across every centre. Attendance and pass rate use trailing 30 /
          90-day windows.
        </p>
      </div>

      {/* Charted headline band. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroCard
          kicker="HQ Roll-Up"
          title={`${totals.centres} Centres`}
          subtitle="across your organisation"
          icon={<Building2 />}
          stats={[
            { label: "Riders", value: totals.riders },
            { label: "Staff", value: totals.staff },
            { label: "Horses", value: totals.horses },
          ]}
        />
        <ChartCard
          label="Riders by Centre"
          value={totals.riders}
          sub={`${totals.centres} centre${totals.centres === 1 ? "" : "s"}`}
          icon={<Users className="h-5 w-5" />}
          chart={<MiniBars data={ridersByCentre.length ? ridersByCentre : [0]} highlightLast={false} />}
        />
        <div className="flex flex-col rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Avg attendance · 30d</div>
          <div className="flex flex-1 items-center justify-center py-2">
            <RingGauge
              value={avgAttendance ?? 0}
              max={100}
              label={avgAttendance === null ? "—" : `${avgAttendance}%`}
              caption={avgAttendance === null ? "no data yet" : "across centres"}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Unpaid Invoices" value={totals.unpaid} tone={totals.unpaid > 0 ? "amber" : undefined} />
        <Kpi label="Certs (90d)" value={totals.certs90} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground">
            <tr>
              <Th left>Centre</Th>
              <Th>Riders</Th>
              <Th>Staff</Th>
              <Th>Horses</Th>
              <Th title="Last 30 days; trailing window">Att.&nbsp;%</Th>
              <Th title="Exams completed in last 90 days">Pass&nbsp;%</Th>
              <Th>Unpaid</Th>
              <Th>Certs&nbsp;(90d)</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 align-top">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">{r.slug}</div>
                  {r.address && <div className="text-[11px] text-muted-foreground">{r.address}</div>}
                </td>
                <Td>{r.activeRiders}</Td>
                <Td>{r.activeStaff}</Td>
                <Td>{r.horses}</Td>
                <Td tone={attendanceTone(r.attendancePct)}>
                  {r.attendancePct == null ? "—" : `${r.attendancePct}%`}
                  {r.attendanceSampleSize > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">({r.attendanceSampleSize})</span>
                  )}
                </Td>
                <Td tone={passTone(r.passRate)}>
                  {r.passRate == null ? "—" : `${r.passRate}%`}
                  {r.examsCompleted90 > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">({r.examsCompleted90})</span>
                  )}
                </Td>
                <Td tone={r.unpaidInvoices > 0 ? "amber" : undefined}>{r.unpaidInvoices}</Td>
                <Td>{r.certs90}</Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No centres yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Numbers in parens after Att.&nbsp;% / Pass&nbsp;% are the underlying sample size for the
        window. Cells without data show "—".
      </p>
    </div>
  );
}

function attendanceTone(pct: number | null): "amber" | "rose" | undefined {
  if (pct == null) return undefined;
  if (pct < 60) return "rose";
  if (pct < 80) return "amber";
  return undefined;
}

function passTone(pct: number | null): "amber" | "rose" | undefined {
  if (pct == null) return undefined;
  if (pct < 50) return "rose";
  if (pct < 70) return "amber";
  return undefined;
}

const TONE_CLS: Record<string, string> = {
  amber: "text-amber-700 dark:text-amber-400",
  rose: "text-rose-700 dark:text-rose-400",
};

function Kpi({ label, value, tone }: { label: string; value: number; tone?: keyof typeof TONE_CLS }) {
  const t: "amber" | "rose" | "default" = tone === "amber" ? "amber" : tone === "rose" ? "rose" : "default";
  return <StatTile label={label} value={value} tone={t} icon={kpiIcon(label)} />;
}

function Th({ children, left, title }: { children: React.ReactNode; left?: boolean; title?: string }) {
  return (
    <th
      className={`px-3 py-2 ${left ? "text-left" : "text-right"}`}
      title={title}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONE_CLS;
}) {
  return (
    <td className={`px-3 py-2 text-right align-top ${tone ? TONE_CLS[tone] : ""}`}>{children}</td>
  );
}
