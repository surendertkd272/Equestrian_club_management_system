import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertRoute } from "@/lib/route-guard";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart } from "@/components/charts/bar-chart";
import { Sparkline } from "@/components/charts/sparkline";

export const dynamic = "force-dynamic";

// Build a list of the last N months (YYYY-MM keys with display labels), oldest-first.
function lastNMonths(n: number): { key: string; label: string; start: Date; end: Date }[] {
  const out: { key: string; label: string; start: Date; end: Date }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    const label = start.toLocaleString("en-IN", { month: "short" });
    out.push({ key, label, start, end });
  }
  return out;
}

export default async function AnalyticsPage() {
  const session = await assertRoute("/analytics");
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const where = tenantWhere(centreId, orgId);

  const months = lastNMonths(6);
  const sixMonthsAgo = months[0].start;

  const [
    totalRiders,
    activeRiders,
    examsAll,
    examsThisYear,
    certificates,
    ridersByLevel,
    revenueByMonth,
    attendanceByMonth,
  ] = await Promise.all([
    prisma.rider.count({ where }),
    prisma.rider.count({ where: { ...where, status: "active" } }),
    prisma.exam.findMany({
      where: { ...where, status: "completed" },
      select: { id: true, passed: true, totalScore: true, date: true },
    }),
    prisma.exam.findMany({
      where: { ...where, status: "completed", date: { gte: sixMonthsAgo } },
      select: { passed: true, date: true },
    }),
    prisma.certificate.count({ where }),
    prisma.rider.groupBy({
      by: ["currentLevel"],
      where: { ...where, status: "active" },
      _count: true,
    }),
    Promise.all(
      months.map((m) =>
        prisma.payment.aggregate({
          where: {
            invoice: tenantWhere(centreId, orgId),
            paidAt: { gte: m.start, lte: m.end },
          },
          _sum: { amount: true },
        }),
      ),
    ),
    Promise.all(
      months.map((m) =>
        prisma.attendance.groupBy({
          by: ["status"],
          where: {
            batch: tenantWhere(centreId, orgId),
            date: { gte: m.start, lte: m.end },
          },
          _count: true,
        }),
      ),
    ),
  ]);

  // ───── Aggregations ─────

  // Overall pass rate
  const passCount = examsAll.filter((e) => e.passed === true).length;
  const failCount = examsAll.filter((e) => e.passed === false).length;
  const passRate = examsAll.length > 0 ? Math.round((passCount / examsAll.length) * 100) : null;
  const avgScore =
    examsAll.length > 0
      ? Math.round(examsAll.reduce((s, e) => s + (e.totalScore ?? 0), 0) / examsAll.length)
      : null;

  // Pass rate sparkline (per month, last 6)
  const passRateSeries = months.map((m) => {
    const inMonth = examsThisYear.filter((e) => e.date >= m.start && e.date <= m.end);
    return inMonth.length > 0 ? Math.round((inMonth.filter((e) => e.passed === true).length / inMonth.length) * 100) : 0;
  });

  // Level distribution
  const levelData = ridersByLevel
    .filter((l) => l.currentLevel)
    .map((l) => ({ label: l.currentLevel as string, value: l._count }))
    .sort((a, b) => b.value - a.value);

  // Revenue per month
  const revenueData = months.map((m, i) => ({
    label: m.label,
    value: Math.round(revenueByMonth[i]._sum.amount ?? 0),
  }));
  const revenueSeries = revenueData.map((d) => d.value);
  const revenueTotal = revenueSeries.reduce((s, v) => s + v, 0);

  // Attendance % per month
  const attendancePctSeries = attendanceByMonth.map((grp) => {
    const present = grp.find((g) => g.status === "present")?._count ?? 0;
    const late = grp.find((g) => g.status === "late")?._count ?? 0;
    const total = grp.reduce((s, g) => s + g._count, 0);
    return total > 0 ? Math.round(((present + late) / total) * 100) : 0;
  });
  const attendanceData = months.map((m, i) => ({ label: m.label, value: attendancePctSeries[i] }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Performance Analytics</h1>
        <p className="text-sm text-muted-foreground">
          {session.role === "SUPER_ADMIN" ? "HQ cross-centre view." : "Centre view."} Last 6 months of trends.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Total exams completed"
          value={examsAll.length.toLocaleString("en-IN")}
          sub={passRate !== null ? `${passRate}% pass rate` : "—"}
          trend={passRateSeries}
        />
        <Tile
          label="Average exam score"
          value={avgScore !== null ? String(avgScore) : "—"}
          sub={`${passCount} pass · ${failCount} fail`}
        />
        <Tile
          label="Certificates issued"
          value={String(certificates)}
          sub="all-time"
        />
      </div>

      {/* Trend block */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue trend (last 6 months)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-end justify-between">
              <div className="text-3xl font-bold">₹{revenueTotal.toLocaleString("en-IN")}</div>
              <div className="text-muted-foreground">
                <Sparkline values={revenueSeries} stroke="hsl(var(--primary))" width={180} height={36} />
              </div>
            </div>
            <BarChart data={revenueData} unit="₹" accent="bg-primary" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attendance % (last 6 months)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-end justify-between">
              <div className="text-3xl font-bold">
                {attendancePctSeries[attendancePctSeries.length - 1]}%
                <span className="ml-1 text-sm font-normal text-muted-foreground">current month</span>
              </div>
              <div className="text-muted-foreground">
                <Sparkline values={attendancePctSeries} stroke="hsl(var(--accent))" width={180} height={36} />
              </div>
            </div>
            <BarChart data={attendanceData} max={100} unit="%" accent="bg-amber-500" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rider distribution by level</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-2 text-sm text-muted-foreground">
              {activeRiders} active of {totalRiders} total
            </div>
            <BarChart data={levelData} accent="bg-emerald-500" emptyMessage="No riders have a level set yet." />
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: number[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-2xl font-bold">{value}</div>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          {trend && trend.length > 0 && (
            <div className="text-primary">
              <Sparkline values={trend} stroke="currentColor" width={70} height={28} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
