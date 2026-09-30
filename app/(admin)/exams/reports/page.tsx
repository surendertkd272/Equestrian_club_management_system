import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { summariseExams, type Row } from "@/lib/exam-reports";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// One table per question. The pass-rate meter is a single-hue bar with the
// number printed beside it, so the table is its own text view.
function RowsTable({ title, rows, labelHeader }: { title: string; rows: Row[]; labelHeader: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exams in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2">{labelHeader}</th>
                <th className="py-1.5 pr-2 text-right">Sat</th>
                <th className="py-1.5 pr-2 text-right">Passed</th>
                <th className="py-1.5 pr-2">Pass rate</th>
                <th className="py-1.5 pr-2 text-right">Avg score</th>
                <th className="py-1.5 text-right">Absent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="py-1.5 pr-2 font-medium">{r.label}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{r.sat}</td>
                  <td className="py-1.5 pr-2 text-right font-mono">{r.passed}</td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${r.passRate ?? 0}%` }} />
                      </div>
                      <span className="font-mono text-xs">{r.passRate === null ? "—" : `${r.passRate}%`}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-xs">{r.avgPct === null ? "—" : `${r.avgPct}%`}</td>
                  <td className="py-1.5 text-right font-mono text-xs">{r.absent || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

// Exam results over a period: by level, school, examiner and month, and how
// closely a panel's judges agree.
export default async function ExamReportsPage({ searchParams }: { searchParams: { from?: string; to?: string; level?: string } }) {
  const session = await requireSession();
  if (!can(session.role, "exam.schedule")) redirect("/exams");
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const centreId = scopeCentre(session);
  if (!centreId) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Exam reports</CardTitle>
          <CardDescription>Reports are per centre. Pick the centre in the top bar first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if ((await getOrgIdForCentre(centreId)) !== orgId) redirect("/exams");

  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const to = isDate(searchParams.to) ? searchParams.to! : ymd(new Date());
  const from = isDate(searchParams.from) ? searchParams.from! : ymd(new Date(Date.now() - 365 * 86400000));
  const level = Number(searchParams.level) || null;

  const [rows, templates] = await Promise.all([
    prisma.exam.findMany({
      where: {
        centreId,
        status: { in: ["completed", "absent"] },
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) },
        ...(level ? { level } : {}),
      },
      select: {
        id: true, level: true, date: true, status: true, passed: true, totalScore: true, examinerName: true,
        scoresJson: true, rubricSnapshotJson: true,
        rider: { select: { firstName: true, lastName: true, school: true, schoolRef: { select: { name: true } } } },
        judges: { select: { judgeName: true, subTotal: true, submittedAt: true } },
      },
      take: 20000,
    }),
    prisma.scoringTemplate.findMany({ where: { centreId }, select: { levelKey: true, levelName: true } }),
  ]);
  const levelName = (n: number) => templates.find((t) => t.levelKey === String(n))?.levelName ?? `Level ${n}`;
  const r = summariseExams(
    rows.map((e) => ({
      ...e,
      school: e.rider.schoolRef?.name ?? e.rider.school ?? "",
      riderName: `${e.rider.firstName} ${e.rider.lastName}`,
    })),
    levelName,
  );
  const inputCls = "mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/exams" className="text-xs text-muted-foreground hover:underline">
          ← Exams
        </Link>
        <h1 className="text-2xl font-bold">Exam reports</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(new Date(from))} – {formatDate(new Date(to))}
          {level ? ` · ${levelName(level)}` : ""}
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="text-xs">
          From
          <input type="date" name="from" defaultValue={from} className={`block ${inputCls}`} />
        </label>
        <label className="text-xs">
          To
          <input type="date" name="to" defaultValue={to} className={`block ${inputCls}`} />
        </label>
        <label className="text-xs">
          Level
          <select name="level" defaultValue={level ?? ""} className={`block ${inputCls}`}>
            <option value="">All levels</option>
            {templates
              .map((t) => Number(t.levelKey))
              .filter(Number.isFinite)
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {levelName(n)}
                </option>
              ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted">
          Show
        </button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Exams sat", String(r.totals.sat)],
          ["Passed", String(r.totals.passed)],
          ["Pass rate", r.totals.passRate === null ? "—" : `${r.totals.passRate}%`],
          ["Absent", String(r.totals.absent)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-2xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <RowsTable title="By level" labelHeader="Level" rows={r.byLevel} />
      <RowsTable title="By month" labelHeader="Month" rows={r.byMonth} />
      <RowsTable title="By school" labelHeader="School" rows={r.bySchool.slice(0, 30)} />
      <RowsTable title="By lead examiner" labelHeader="Examiner" rows={r.byExaminer} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How closely judges agree</CardTitle>
          <CardDescription>
            {r.panelledExams === 0
              ? "No exams in this period were marked by more than one judge."
              : `${r.panelledExams} exams were marked by a panel. The spread is the gap between the highest and lowest card, as a share of the maximum score; a judge's lean is how far their card sits from the rest of the panel on average (+ marks higher, − lower).`}
          </CardDescription>
        </CardHeader>
        {r.panelledExams > 0 && (
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-2">Judge</th>
                  <th className="py-1.5 pr-2 text-right">Panels</th>
                  <th className="py-1.5 pr-2 text-right">Lean</th>
                  <th className="py-1.5 text-right">Typical gap</th>
                </tr>
              </thead>
              <tbody>
                {r.judges.map((j) => (
                  <tr key={j.name} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 font-medium">{j.name}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{j.panels}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">
                      {j.meanDev > 0 ? "+" : ""}
                      {j.meanDev} pts
                    </td>
                    <td className="py-1.5 text-right font-mono">{j.meanAbsDev} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Widest spreads</div>
              <ul className="space-y-1 text-sm">
                {r.spreads.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 border-b py-1 last:border-0">
                    <Link href={`/exams/${s.id}`} className="min-w-0 truncate hover:underline">
                      {s.riderName} · {levelName(s.level)} · {formatDate(s.date)}
                    </Link>
                    <span className="shrink-0 font-mono text-xs">
                      {s.spreadPct}% · {s.cards} cards
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
