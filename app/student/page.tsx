import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getStudentSummary, getStudentDetail } from "@/lib/student";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroCard } from "@/components/dashboard/visuals";
import { RingGauge } from "@/components/ui/charts";
import { Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { getFeaturesForSession } from "@/lib/features-gate";
import { loadRiderExamHistory } from "@/lib/exam-history";
import { ExamHistoryList } from "@/components/exams/exam-history-list";
import { BmiBanner } from "./bmi-banner";
import { BatchShiftCard } from "./batch-shift-card";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Monthly-skill rating scale (MonthlySkillMark.rating): 0 not-yet · 1 needs-work
// · 2 confident · 3 mastered. Drives the badge on each "this month's skills" row.
const RATING: Record<number, { label: string; variant: "success" | "warning" | "secondary" | "outline" }> = {
  0: { label: "not yet", variant: "outline" },
  1: { label: "needs work", variant: "warning" },
  2: { label: "confident", variant: "secondary" },
  3: { label: "mastered", variant: "success" },
};

export default async function StudentHome() {
  const session = (await getSession())!;
  const summary = await getStudentSummary(session.userId);

  if (!summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Portal Isn't Set up Yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Your account isn't linked to a rider profile. Please contact your centre — a
          manager can link your account from your rider profile.
        </CardContent>
      </Card>
    );
  }

  const detail = await getStudentDetail(session.userId);
  const { rider, attendancePct, attendedSessions, totalSessions, upcomingExam, latestCert, unpaidInvoices, monthlySkillsTotal, monthlySkillsMastered, skillsMonth } = summary;
  // "2026-06" → "June 2026" for display.
  const monthLabel = new Date(`${skillsMonth}-01T00:00:00`).toLocaleString("en-IN", { month: "long", year: "numeric" });

  // student-payment-visible defaults OFF — the parent handles payment
  // via the email link, not the student. Owner toggles it on per-tenant
  // in the feature matrix when a club explicitly wants students to see
  // the invoice surface.
  // AND-gated on fee-collection: if the tenant turned off parent-facing
  // payment entirely, the student tile shouldn't appear even when the
  // fine-grained student flag is on. fee-collection is the master.
  const features = await getFeaturesForSession(session);
  const showPayment =
    features.has("student-payment-visible") && features.has("fee-collection");

  // Batch shift surface — rider sees their own request history + the
  // 'Request a shift' button. Centre-scoped batch list (target batches
  // they could move to). Same-centre only via this UI.
  const [centreBatches, recentShiftRequests, examHistory] = await Promise.all([
    prisma.batch.findMany({
      where: { centreId: rider.centreId },
      select: { id: true, name: true, dayOfWeek: true, startTime: true, endTime: true },
      orderBy: { startTime: "asc" },
    }),
    prisma.batchShiftRequest.findMany({
      where: { riderId: rider.id },
      include: { toBatch: { select: { name: true } }, fromBatch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    loadRiderExamHistory(rider.id, rider.centreId, { take: 10 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Hi {rider.firstName}! 🐎
        </h1>
        <p className="text-sm text-muted-foreground">
          {rider.centre.name} · {rider.currentLevel ?? "—"}{rider.batch ? ` · ${rider.batch.name}` : ""}
        </p>
      </div>

      {/* One-shot dismissible heads-up when the rider's BMI is outside the
          normal adult band. Stays on the dashboard not the profile so the
          first thing they see when logging in is the note. Banner hides
          itself once dismissed (localStorage); re-triggers if the BMI
          value changes meaningfully. */}
      <BmiBanner riderId={rider.id} bmi={rider.bmi} />

      {detail && detail.notifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What's New</CardTitle>
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

      {/* Athlete hero — the rider's own progress front and centre. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroCard
          className="lg:col-span-2"
          kicker="My Progress"
          title={`${rider.firstName}'s Journey`}
          subtitle={`${rider.currentLevel ?? "Unranked"}${rider.batch ? ` · ${rider.batch.name}` : ""}`}
          icon={<Trophy />}
          progress={
            monthlySkillsTotal > 0
              ? { value: monthlySkillsMastered, max: monthlySkillsTotal, label: `${monthlySkillsMastered} of ${monthlySkillsTotal} skills mastered — ${monthLabel}` }
              : undefined
          }
          stats={[
            { label: "Attendance", value: attendancePct === null ? "—" : `${attendancePct}%` },
            { label: "Next Exam", value: upcomingExam ? `L${upcomingExam.level}` : "—" },
            showPayment
              ? { label: "Unpaid Fees", value: String(unpaidInvoices) }
              : { label: "Skills This Month", value: monthlySkillsTotal > 0 ? `${monthlySkillsMastered}/${monthlySkillsTotal}` : "—" },
          ]}
        />
        <div className="flex flex-col rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Attendance · 90 days</div>
          <div className="flex flex-1 items-center justify-center py-2">
            <RingGauge
              value={attendancePct ?? 0}
              max={100}
              label={attendancePct === null ? "—" : `${attendancePct}%`}
              caption={attendancePct === null ? "no data yet" : `${attendedSessions}/${totalSessions} sessions`}
            />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My Class</CardTitle>
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

      <BatchShiftCard
        currentBatchId={rider.batchId ?? null}
        batches={centreBatches}
        recent={recentShiftRequests.map((r) => ({
          id: r.id,
          kind: r.kind,
          shiftDate: r.shiftDate?.toISOString() ?? null,
          toBatch: { name: r.toBatch.name },
          fromBatch: r.fromBatch ? { name: r.fromBatch.name } : null,
          status: r.status,
          decisionNote: r.decisionNote ?? null,
          createdAt: r.createdAt.toISOString(),
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Exam History</CardTitle>
        </CardHeader>
        <CardContent>
          <ExamHistoryList exams={examHistory} />
        </CardContent>
      </Card>

      {detail && detail.upcomingLessons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Lessons (Next 2 Weeks)</CardTitle>
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
              <CardTitle>Recent Attendance</CardTitle>
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
                            ? "bg-muted text-muted-foreground"
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
              <CardTitle>This month&apos;s skills · {detail.skillsMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">No skills set for this month yet — your coach will add them.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.skills.map((s) => {
                    const r = RATING[s.rating] ?? RATING[0];
                    return (
                      <div key={s.label} className="flex items-center justify-between rounded-md border p-2">
                        <span className="text-sm" title={s.coachNotes ?? undefined}>{s.label}</span>
                        <Badge variant={r.variant}>{r.label}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My Exams</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.exams.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exams yet.</p>
              ) : (
                <div className="overflow-x-auto"><table className="w-full text-sm">
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
                        <td className="py-2">{e.examinerName ?? "—"}</td>
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
                </table></div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>My Certificates</CardTitle>
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
