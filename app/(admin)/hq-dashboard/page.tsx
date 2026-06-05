import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { StatTile } from "@/components/ui/stat-tile";

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

  // Per-centre metrics in parallel. Each query is small and indexed.
  const rows = await Promise.all(
    centres.map(async (c) => {
      const [
        activeRiders,
        activeStaff,
        horses,
        attendance30,
        unpaidInvoices,
        exams90,
        certs90,
      ] = await Promise.all([
        prisma.rider.count({ where: { centreId: c.id, status: "active" } }),
        prisma.user.count({ where: { centreId: c.id, status: "active" } }),
        prisma.horse.count({ where: { centreId: c.id, status: "active" } }),
        prisma.attendance.findMany({
          where: { batch: { centreId: c.id }, date: { gte: thirty } },
          select: { status: true },
        }),
        prisma.invoice.count({ where: { centreId: c.id, status: "due" } }),
        prisma.exam.findMany({
          where: {
            centreId: c.id,
            status: "completed",
            updatedAt: { gte: ninety },
          },
          select: { passed: true },
        }),
        prisma.certificate.count({ where: { centreId: c.id, issuedAt: { gte: ninety } } }),
      ]);

      const present = attendance30.filter((a) => a.status === "present" || a.status === "late").length;
      const attendancePct = attendance30.length > 0
        ? Math.round((present / attendance30.length) * 100)
        : null;

      const passed = exams90.filter((e) => e.passed === true).length;
      const passRate = exams90.length > 0 ? Math.round((passed / exams90.length) * 100) : null;

      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        address: c.address,
        activeRiders,
        activeStaff,
        horses,
        attendancePct,
        attendanceSampleSize: attendance30.length,
        unpaidInvoices,
        passRate,
        examsCompleted90: exams90.length,
        certs90,
      };
    }),
  );

  // Roll-up totals across the org. Useful as a sanity check + headline KPIs.
  const totals = {
    centres: rows.length,
    riders: rows.reduce((s, r) => s + r.activeRiders, 0),
    staff: rows.reduce((s, r) => s + r.activeStaff, 0),
    horses: rows.reduce((s, r) => s + r.horses, 0),
    unpaid: rows.reduce((s, r) => s + r.unpaidInvoices, 0),
    certs90: rows.reduce((s, r) => s + r.certs90, 0),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">HQ Comparative Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Side-by-side metrics across every centre. Attendance and pass rate use trailing 30 /
          90-day windows.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Kpi label="Centres" value={totals.centres} />
        <Kpi label="Riders" value={totals.riders} />
        <Kpi label="Staff" value={totals.staff} />
        <Kpi label="Horses" value={totals.horses} />
        <Kpi label="Unpaid invoices" value={totals.unpaid} tone={totals.unpaid > 0 ? "amber" : undefined} />
        <Kpi label="Certs (90d)" value={totals.certs90} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
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
  return <StatTile label={label} value={value} tone={t} />;
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
