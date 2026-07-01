import { notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getChildDetail } from "@/lib/parent";
import { getFeaturesForSession } from "@/lib/features-gate";
import { loadRiderExamHistory } from "@/lib/exam-history";
import { ExamHistoryList } from "@/components/exams/exam-history-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

export default async function ParentChildPage({ params }: { params: { riderId: string } }) {
  const session = (await getSession())!;
  const [detail, features] = await Promise.all([
    getChildDetail(session.userId, params.riderId),
    getFeaturesForSession(session),
  ]);
  if (!detail) notFound();
  const { rider, relationship, attendance, attendancePct, skills, exams, certificates, invoices, upcomingLessons } = detail;
  // Master fee-collection switch — when OFF, the Invoices card is suppressed.
  // Existing invoices remain in the DB for audit; only the surface disappears.
  const showPayment = features.has("fee-collection");
  // Exam history with rubric attached for the expandable per-exam breakdown.
  const examHistory = await loadRiderExamHistory(rider.id, rider.centreId, { take: 10 });

  const skillsByLevel = new Map<string, typeof skills>();
  for (const s of skills) {
    const lvl = s.skill.level?.name ?? "—";
    const arr = skillsByLevel.get(lvl) ?? [];
    arr.push(s);
    skillsByLevel.set(lvl, arr);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <Link href="/parent" className="text-sm text-muted-foreground hover:underline">
            ← All children
          </Link>
          <h1 className="text-2xl font-bold">
            {rider.firstName} {rider.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {rider.centre.name} · level {rider.currentLevel ?? "—"} ·{" "}
            <Badge variant="outline">{relationship}</Badge>
            {rider.school && <span> · {rider.school}</span>}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard label="Attendance (90d)" value={attendancePct === null ? "—" : `${attendancePct}%`} />
        <KpiCard label="Skills Mastered" value={String(skills.filter((s) => s.status === "mastered").length)} />
        <KpiCard label="Exams Taken" value={String(exams.filter((e) => e.status === "completed").length)} />
        <KpiCard label="Certificates" value={String(certificates.length)} />
      </div>

      {upcomingLessons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Lessons (Next 2 Weeks)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {upcomingLessons.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">
                      {new Date(a.startAt).toLocaleString("en-IN", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.lesson?.batch?.name ?? "Ad-hoc"}{a.lesson?.batch?.level ? ` · ${a.lesson.batch.level}` : ""} · Horse: {a.horse.name}{a.horse.stableNo ? ` (${a.horse.stableNo})` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Attendance (Last 90 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {attendance.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attendance records yet.</p>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {attendance.slice(0, 20).map((a, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2">{formatDate(a.date)}</td>
                    <td className="py-2">
                      <Badge
                        variant={
                          a.status === "present"
                            ? "success"
                            : a.status === "late"
                              ? "warning"
                              : a.status === "excused"
                                ? "outline"
                                : "destructive"
                        }
                      >
                        {formatEnum(a.status)}
                      </Badge>
                    </td>
                    <td className="py-2 text-muted-foreground">{a.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skills</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No skills tracked yet.</p>
          ) : (
            Array.from(skillsByLevel.entries()).map(([levelName, items]) => (
              <div key={levelName}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {levelName}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((s) => (
                    <div key={s.skillId} className="flex items-center justify-between rounded-md border p-2">
                      <span className="text-sm">{s.skill.name}</span>
                      <Badge
                        variant={
                          s.status === "mastered"
                            ? "success"
                            : s.status === "practicing"
                              ? "warning"
                              : "outline"
                        }
                      >
                        {formatEnum(s.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exams</CardTitle>
        </CardHeader>
        <CardContent>
          <ExamHistoryList exams={examHistory} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Certificates</CardTitle>
        </CardHeader>
        <CardContent>
          {certificates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No certificates issued yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {certificates.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b py-2">
                  <span>
                    <Badge variant="outline">{formatEnum(c.type)}</Badge> {c.levelName}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.serialNo} · issued {formatDate(c.issuedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {showPayment && (
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2">Created</th>
                    <th className="pb-2">Kind</th>
                    <th className="pb-2">Amount</th>
                    <th className="pb-2">Due</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-t">
                      <td className="py-2">{formatDate(i.createdAt)}</td>
                      <td className="py-2">{formatEnum(i.kind)}</td>
                      <td className="py-2 font-semibold">₹{i.amount.toLocaleString("en-IN")}</td>
                      <td className="py-2">{formatDate(i.dueDate)}</td>
                      <td className="py-2">
                        <Badge
                          variant={
                            i.status === "paid"
                              ? "success"
                              : i.status === "overdue"
                                ? "destructive"
                                : "warning"
                          }
                        >
                          {formatEnum(i.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
