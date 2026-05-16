import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getStudentSummary, getStudentDetail } from "@/lib/student";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StudentHome() {
  const session = (await getSession())!;
  const summary = await getStudentSummary(session.userId);

  if (!summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your portal isn't set up yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Your account isn't linked to a rider profile. Please contact your centre — a
          manager can link your account from your rider profile.
        </CardContent>
      </Card>
    );
  }

  const detail = await getStudentDetail(session.userId);
  const { rider, attendancePct, attendedSessions, totalSessions, upcomingExam, latestCert, unpaidInvoices, skillsMastered, totalSkillsAtLevel } = summary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Hi {rider.firstName}! 🐎
        </h1>
        <p className="text-sm text-muted-foreground">
          {rider.centre.name} · {rider.currentLevel ?? "Beginner"}{rider.batch ? ` · ${rider.batch.name}` : ""}
        </p>
      </div>

      {detail && detail.notifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What's new</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {detail.notifications.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-3 border-b py-2 last:border-b-0">
                  <div>
                    <div className="font-medium">{n.title}</div>
                    <div className="text-xs text-muted-foreground">{n.body}</div>
                  </div>
                  <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDate(n.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="My attendance (90d)" value={attendancePct === null ? "—" : `${attendancePct}%`} sub={attendancePct === null ? "" : `${attendedSessions}/${totalSessions} sessions`} />
        <Kpi
          label="Skills mastered"
          value={`${skillsMastered}${totalSkillsAtLevel > 0 ? ` / ${totalSkillsAtLevel}` : ""}`}
          sub={totalSkillsAtLevel > 0 ? `${Math.round((skillsMastered / totalSkillsAtLevel) * 100)}% of catalog` : ""}
        />
        <Kpi
          label="Next exam"
          value={upcomingExam ? `L${upcomingExam.level}` : "—"}
          sub={upcomingExam ? `${formatDate(upcomingExam.date)} · ${upcomingExam.examinerName}` : "Nothing scheduled"}
        />
        <Kpi
          label="Unpaid fees"
          value={String(unpaidInvoices)}
          sub={unpaidInvoices > 0 ? "Talk to your parent" : "All paid up"}
          warn={unpaidInvoices > 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My class</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {rider.batch ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Batch</div>
                <div className="font-medium">{rider.batch.name}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Days</div>
                <div className="font-medium">{rider.batch.dayOfWeek.replaceAll(",", " · ")}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Time</div>
                <div className="font-medium">
                  {rider.batch.startTime} – {rider.batch.endTime}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">You haven't been assigned to a batch yet.</p>
          )}
        </CardContent>
      </Card>

      {detail && detail.upcomingLessons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming lessons (next 2 weeks)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {detail.upcomingLessons.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">
                      {new Date(a.startAt).toLocaleString("en-IN", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.lesson?.batch?.name ?? "Ad-hoc"} · You'll ride <strong>{a.horse.name}</strong>{a.horse.stableNo ? ` (${a.horse.stableNo})` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {detail && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Recent attendance</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.attendance.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions recorded yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {detail.attendance.map((a, i) => {
                    const cls =
                      a.status === "present"
                        ? "bg-emerald-500 text-white"
                        : a.status === "late"
                          ? "bg-amber-500 text-white"
                          : a.status === "excused"
                            ? "bg-slate-300"
                            : "bg-rose-500 text-white";
                    return (
                      <span
                        key={i}
                        className={`rounded-md px-2 py-1 text-[10px] font-medium ${cls}`}
                        title={`${formatDate(a.date)} · ${a.status}${a.reason ? ` · ${a.reason}` : ""}`}
                      >
                        {formatDate(a.date).slice(0, 6)}
                      </span>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My skills</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">No skills tracked yet — keep going!</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.skills.map((s) => (
                    <div key={s.skillId} className="flex items-center justify-between rounded-md border p-2">
                      <span className="text-sm">
                        {s.skill.name}
                        <span className="ml-1 text-[10px] text-muted-foreground">{s.skill.level?.name ?? ""}</span>
                      </span>
                      <Badge
                        variant={
                          s.status === "mastered"
                            ? "success"
                            : s.status === "practicing"
                              ? "warning"
                              : "outline"
                        }
                      >
                        {s.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My exams</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.exams.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exams yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Level</th>
                      <th className="pb-2">Examiner</th>
                      <th className="pb-2">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.exams.map((e) => (
                      <tr key={e.id} className="border-t">
                        <td className="py-2">{formatDate(e.date)}</td>
                        <td className="py-2">L{e.level}</td>
                        <td className="py-2">{e.examinerName}</td>
                        <td className="py-2">
                          {e.passed === true ? (
                            <Badge variant="success">passed ({e.totalScore})</Badge>
                          ) : e.passed === false ? (
                            <Badge variant="destructive">try again ({e.totalScore})</Badge>
                          ) : (
                            <Badge variant="outline">{e.status}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My certificates</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.certificates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No certificates earned yet — keep going!</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {detail.certificates.map((c) => (
                    <li key={c.id} className="flex items-center justify-between border-b py-2">
                      <span>
                        <Badge variant="outline">{c.type}</Badge> {c.levelName}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {c.serialNo} · {formatDate(c.issuedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {latestCert && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Latest: <Link href={`/verify/${latestCert.serialNo}`} className="text-primary underline">{latestCert.serialNo}</Link>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, warn = false }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-bold ${warn ? "text-amber-600" : ""}`}>{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
