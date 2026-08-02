import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart } from "@/components/charts/bar-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { PLATFORM_TZ } from "@/lib/tz";

export const dynamic = "force-dynamic";

export default async function RiderAnalytics({ params }: { params: { id: string } }) {
  const session = await requireSession();
  const centreId = scopeCentre(session);

  const rider = await prisma.rider.findUnique({
    where: { id: params.id },
    select: { id: true, firstName: true, lastName: true, centreId: true, currentLevel: true, joiningDate: true },
  });
  if (!rider) notFound();
  if (centreId && rider.centreId !== centreId) notFound();

  const [exams, certificates, skillStatus, attendance, totalSkillsAtCentre] = await Promise.all([
    prisma.exam.findMany({
      where: { riderId: rider.id, status: "completed" },
      orderBy: { date: "asc" },
      select: { id: true, level: true, date: true, totalScore: true, passed: true },
    }),
    prisma.certificate.findMany({
      where: { riderId: rider.id },
      orderBy: { issuedAt: "desc" },
      take: 20,
    }),
    prisma.riderSkillStatus.findMany({
      where: { riderId: rider.id },
      include: { skill: { select: { discipline: true } } },
    }),
    prisma.attendance.findMany({
      where: { riderId: rider.id },
      orderBy: { date: "asc" },
    }),
    prisma.skill.count({ where: { level: { centreId: rider.centreId } } }),
  ]);

  // Exam score trend
  const examScores = exams.map((e) => e.totalScore ?? 0);
  const examPassRate =
    exams.length > 0 ? Math.round((exams.filter((e) => e.passed === true).length / exams.length) * 100) : null;

  // Skill mastery by discipline
  const masteredByDiscipline = new Map<string, number>();
  const totalByDiscipline = new Map<string, number>();
  for (const s of skillStatus) {
    if (s.status === "mastered") {
      masteredByDiscipline.set(s.skill.discipline, (masteredByDiscipline.get(s.skill.discipline) ?? 0) + 1);
    }
  }
  const allSkills = await prisma.skill.findMany({
    where: { level: { centreId: rider.centreId } },
    select: { discipline: true },
  });
  for (const s of allSkills) {
    totalByDiscipline.set(s.discipline, (totalByDiscipline.get(s.discipline) ?? 0) + 1);
  }
  const disciplineData = Array.from(totalByDiscipline.keys())
    .map((d) => {
      const m = masteredByDiscipline.get(d) ?? 0;
      const t = totalByDiscipline.get(d) ?? 1;
      return { label: d.replaceAll("_", " "), value: m, sub: `${m}/${t}` };
    })
    .sort((a, b) => b.value - a.value);

  // Attendance % overall
  const aPresent = attendance.filter((a) => a.status === "present" || a.status === "late").length;
  const attendancePct = attendance.length > 0 ? Math.round((aPresent / attendance.length) * 100) : null;

  // Attendance trend per month (last 6)
  function lastNMonths(n: number) {
    const out: { label: string; start: Date; end: Date }[] = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      out.push({ label: start.toLocaleString("en-IN", { timeZone: PLATFORM_TZ, month: "short" }), start, end });
    }
    return out;
  }
  const months = lastNMonths(6);
  const attendanceMonthly = months.map((m) => {
    const inMonth = attendance.filter((a) => a.date >= m.start && a.date <= m.end);
    if (inMonth.length === 0) return 0;
    return Math.round((inMonth.filter((a) => a.status === "present" || a.status === "late").length / inMonth.length) * 100);
  });

  const mastered = skillStatus.filter((s) => s.status === "mastered").length;
  const masteryPct = totalSkillsAtCentre > 0 ? Math.round((mastered / totalSkillsAtCentre) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/riders/${rider.id}`}>
            <ChevronLeft className="h-4 w-4" /> Back to profile
          </Link>
        </Button>
        <Badge variant="outline">{rider.currentLevel ?? "—"}</Badge>
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          Analytics · {rider.firstName} {rider.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Joined {formatDate(rider.joiningDate)} · {exams.length} exams · {certificates.length} certificates
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KPI label="Exam Pass Rate" value={examPassRate === null ? "—" : `${examPassRate}%`} sub={`${exams.length} taken`} />
        <KPI label="Skill Mastery" value={`${masteryPct}%`} sub={`${mastered}/${totalSkillsAtCentre}`} />
        <KPI label="Attendance" value={attendancePct === null ? "—" : `${attendancePct}%`} sub={`${attendance.length} sessions`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Exam Score Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {exams.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No exam history yet.</p>
            ) : (
              <>
                <div className="mb-3 flex items-end justify-between">
                  <div className="text-3xl font-bold">{examScores[examScores.length - 1]}</div>
                  <div className="text-primary">
                    <Sparkline values={examScores} stroke="currentColor" width={200} height={48} />
                  </div>
                </div>
                <table className="w-full text-xs">
                  <thead className="text-left text-[10px] text-muted-foreground">
                    <tr>
                      <th className="pb-1">Date</th>
                      <th className="pb-1">Level</th>
                      <th className="pb-1">Score</th>
                      <th className="pb-1">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exams.map((e) => (
                      <tr key={e.id} className="border-t border-dashed">
                        <td className="py-1">{formatDate(e.date)}</td>
                        <td className="py-1">L{e.level}</td>
                        <td className="py-1 font-mono">{e.totalScore ?? "—"}</td>
                        <td className="py-1">
                          {e.passed === true && <Badge variant="success">PASS</Badge>}
                          {e.passed === false && <Badge variant="destructive">FAIL</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attendance (Last 6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-end justify-between">
              <div className="text-3xl font-bold">
                {attendanceMonthly[attendanceMonthly.length - 1]}%
              </div>
              <div className="text-amber-600">
                <Sparkline values={attendanceMonthly} stroke="currentColor" width={200} height={48} />
              </div>
            </div>
            <BarChart
              data={months.map((m, i) => ({ label: m.label, value: attendanceMonthly[i] }))}
              max={100}
              unit="%"
              accent="bg-amber-500"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Skill Mastery by Discipline</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={disciplineData} accent="bg-emerald-500" />
          </CardContent>
        </Card>

      </div>

      {certificates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Certificates</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {certificates.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b border-dashed py-1">
                  <span>
                    <b>{c.type === "promotion" ? "Level promotion" : c.type}</b>
                    {c.levelName ? ` · ${c.levelName}` : ""}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {c.serialNo} · {formatDate(c.issuedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
