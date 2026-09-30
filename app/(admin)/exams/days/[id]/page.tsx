import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExportCsvButton } from "@/components/ui/export-csv";
import { formatDate } from "@/lib/utils";
import { RescheduleForm, CancelDayButton } from "../../exam-actions";
import { AddLateRiders } from "../../add-riders";
import { SendResultsButton } from "../../send-results-button";
import { ResultsHold } from "../../results-hold";
import { SlotNoticeButton } from "../../slot-notice-button";
import { JudgeReadinessBanner, type JudgeRow } from "../../judge-readiness";
import { examinerReadiness } from "@/lib/examiner-readiness";
import { examinerLabel } from "@/lib/examiner-label";
import { sittingLabel } from "@/lib/exam-labels";
import { isExamManager } from "@/lib/exam-panel";
import { levelLadder, suggestedLevel } from "@/lib/exam-booking";
import { ENROLLED_RIDER_STATUSES } from "@/lib/rider-status";
import { todayYmdForCentre } from "@/lib/centre-tz";

export const dynamic = "force-dynamic";

const CAN_VIEW = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "EXAMINER"];

// One exam day at a glance: every level, how far marking has got, and the
// results so far — plus the controls to move or cancel the whole day.
export default async function ExamDayPage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!CAN_VIEW.includes(session.role)) redirect("/exams");

  const day = await prisma.examDay.findUnique({
    where: { id: params.id },
    include: {
      sittings: {
        orderBy: [{ level: "asc" }, { groupNo: "asc" }],
        include: {
          examiners: { select: { examinerName: true, examinerId: true }, orderBy: { examinerName: "asc" } },
          exams: {
            select: {
              status: true, examinerId: true, passed: true, reopenedAt: true, time: true, resultEmailSentAt: true,
              date: true, slotNotified: true,
            },
          },
        },
      },
    },
  });
  if (!day) notFound();
  if (await centreFence(session, day.centreId)) notFound();
  // An examiner sees an exam day they are working on.
  if (
    session.role === "EXAMINER" &&
    !day.sittings.some(
      (s) => s.examiners.some((x) => x.examinerId === session.userId) || s.panelJudgeIds.includes(session.userId),
    )
  ) {
    redirect("/exams");
  }

  const templates = await prisma.scoringTemplate.findMany({
    where: { centreId: day.centreId },
    select: { levelKey: true, levelName: true },
  });
  const levelName = (n: number) => templates.find((t) => t.levelKey === String(n))?.levelName ?? `Level ${n}`;

  const judgeIds = Array.from(new Set(day.sittings.flatMap((s) => [...s.examiners.map((x) => x.examinerId), ...s.panelJudgeIds])));
  const judgeUsers = await prisma.user.findMany({
    where: { id: { in: judgeIds } },
    select: { id: true, name: true, status: true, mustChangePassword: true, accessExpiresAt: true },
  });
  const userById = new Map(judgeUsers.map((u) => [u.id, u]));
  const judgeRows: JudgeRow[] = judgeIds.map((id) => {
    const u = userById.get(id);
    return {
      id,
      name: u?.name ?? "Judge",
      readiness: u ? examinerReadiness(u, day.date) : { ok: false, label: "account removed", tone: "destructive" },
    };
  });
  const notReady = new Set(judgeRows.filter((j) => !j.readiness.ok).map((j) => j.id));
  const upcoming = day.date.toISOString().slice(0, 10) >= (await todayYmdForCentre(day.centreId));

  const rows = day.sittings.map((s) => {
    const done = s.exams.filter((e) => e.status === "completed");
    return {
      id: s.id,
      level: s.level,
      title: sittingLabel(levelName(s.level), s.groupNo),
      pool: s.examiners.map((x) => `${x.examinerName}${upcoming && notReady.has(x.examinerId) ? " ⚠" : ""}`),
      panel: s.panelJudgeIds.map((id) => `${userById.get(id)?.name ?? "Judge"}${upcoming && notReady.has(id) ? " ⚠" : ""}`),
      riders: s.exams.length,
      waiting: s.exams.filter((e) => e.status === "scheduled" && !e.examinerId).length,
      marking: s.exams.filter((e) => (e.status === "scheduled" || e.status === "in_progress") && e.examinerId).length,
      completed: done.length,
      absent: s.exams.filter((e) => e.status === "absent").length,
      passed: done.filter((e) => e.passed === true).length,
      start: s.exams[0]?.time ?? day.time,
    };
  });
  const levelCount = new Set(rows.map((r) => r.level)).size;
  const sum = (k: "riders" | "waiting" | "marking" | "completed" | "passed" | "absent") =>
    rows.reduce((n, r) => n + r[k], 0);
  const withResults = day.sittings.reduce(
    (n, s) => n + s.exams.filter((e) => e.status === "completed" || e.reopenedAt).length,
    0,
  );
  const waitingTotal = sum("riders") - withResults;
  const canSchedule = can(session.role, "exam.schedule");
  const allExams = day.sittings.flatMap((s) => s.exams);
  const markedTotal = allExams.filter((e) => e.status === "completed").length;
  const unsentResults = allExams.filter((e) => e.status === "completed" && !e.resultEmailSentAt).length;
  const slotWaiting = day.sittings.filter((s) => s.slotMinutes).flatMap((s) => s.exams.filter((e) => e.status === "scheduled"));
  const slotKey = (e: (typeof slotWaiting)[number]) => `${e.date.toISOString().slice(0, 10)} ${e.time}`;
  const freshSlots = slotWaiting.filter((e) => !e.slotNotified).length;
  const changedSlots = slotWaiting.filter((e) => e.slotNotified && e.slotNotified !== slotKey(e)).length;
  // Riders who didn't pass or were absent on this day and aren't booked again.
  const resitRiders = await prisma.exam.findMany({
    where: { sitting: { examDayId: day.id }, OR: [{ status: "absent" }, { status: "completed", passed: false }] },
    select: { riderId: true, level: true },
  });
  const rebooked = resitRiders.length
    ? new Set(
        (
          await prisma.exam.findMany({
            where: { riderId: { in: resitRiders.map((e) => e.riderId) }, status: { in: ["scheduled", "in_progress"] } },
            select: { riderId: true },
          })
        ).map((e) => e.riderId),
      )
    : new Set<string>();
  const resits = resitRiders.filter((e) => !rebooked.has(e.riderId)).length;
  const canPrintCerts = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"].includes(session.role);
  const liveCerts = markedTotal
    ? await prisma.certificate.count({ where: { exam: { sitting: { examDayId: day.id } }, revokedAt: null } })
    : 0;
  // Riders not on the day yet, for "Add late riders".
  const lateRiders =
    canSchedule && upcoming
      ? await (async () => {
          const ladder = await levelLadder(prisma, day.centreId);
          const onDay = await prisma.exam.findMany({ where: { sitting: { examDayId: day.id } }, select: { riderId: true } });
          const booked = new Set(onDay.map((e) => e.riderId));
          const [riders, examiners] = await Promise.all([
            prisma.rider.findMany({
              where: { centreId: day.centreId, status: { in: [...ENROLLED_RIDER_STATUSES] } },
              select: { id: true, firstName: true, lastName: true, currentLevel: true, school: true, schoolRef: { select: { name: true } } },
              orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
            }),
            prisma.user.findMany({
              where: {
                centreId: day.centreId, role: "EXAMINER", status: "active",
                OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gte: day.date } }],
              },
              select: { id: true, name: true, accessExpiresAt: true, mustChangePassword: true },
              orderBy: { name: "asc" },
            }),
          ]);
          return {
            levels: Array.from(ladder.byRank.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([rank, t]) => ({ rank, name: t.levelName })),
            examiners: examiners.map((u) => ({ id: u.id, name: examinerLabel(u) })),
            riders: riders
              .filter((r) => !booked.has(r.id))
              .map((r) => ({
                id: r.id,
                name: `${r.firstName} ${r.lastName}`,
                school: r.schoolRef?.name ?? r.school ?? "",
                currentLevel: r.currentLevel,
                suggested: suggestedLevel(ladder, r.currentLevel),
              })),
          };
        })()
      : null;
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/exams" className="text-xs text-muted-foreground hover:underline">
            ← Exams
          </Link>
          <h1 className="text-2xl font-bold">{day.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(day.date)} · starts {day.time} · {sum("riders")} rider{sum("riders") === 1 ? "" : "s"} across{" "}
            {levelCount} level{levelCount === 1 ? "" : "s"}
            {rows.length > levelCount ? ` in ${rows.length} groups` : ""}
          </p>
          {day.notes && <p className="mt-1 text-sm">{day.notes}</p>}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <ExportCsvButton entity="exams" label="Export results" query={`dayId=${day.id}`} />
          {canSchedule && <SendResultsButton scope="day" id={day.id} unsent={unsentResults} marked={markedTotal} />}
          {canSchedule && <SlotNoticeButton scope="day" id={day.id} fresh={freshSlots} changed={changedSlots} />}
          {canSchedule && resits > 0 && (
            <Link
              href={`/exams/days/new?resit=${day.id}`}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
            >
              Book re-sits ({resits})
            </Link>
          )}
          {canSchedule && upcoming && (
            <Link
              href={`/exams/check-in?day=${day.id}`}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
            >
              Check-in desk
            </Link>
          )}
          {canPrintCerts && liveCerts > 0 && (
            <Link
              href={`/certificates/print?day=${day.id}`}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
            >
              Print certificates ({liveCerts})
            </Link>
          )}
        </div>
      </div>

      {upcoming && <JudgeReadinessBanner judges={judgeRows} canManage={isExamManager(session.role)} />}
      {canSchedule && (
        <ResultsHold
          scope="day"
          id={day.id}
          held={day.sittings.some((s) => s.holdResults && !s.resultsPublishedAt) || (day.sittings.length === 0 && day.holdResults)}
          published={day.sittings.length > 0 && day.sittings.every((s) => !!s.resultsPublishedAt)}
          marked={markedTotal}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Waiting", sum("waiting")],
          ["Being marked", sum("marking")],
          ["Marked", `${sum("completed")} / ${sum("riders") - sum("absent")}${sum("absent") ? ` · ${sum("absent")} absent` : ""}`],
          ["Passed", sum("completed") ? `${sum("passed")} (${pct(sum("passed"), sum("completed"))}%)` : "—"],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Levels on the day</CardTitle>
          <CardDescription>
            Each level is its own sitting (a big level runs as groups) — examiners pick riders from their queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No riders left on this day.</p>}
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/exams/sittings/${r.id}`}
              className="block rounded-md border p-3 hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{r.title}</span>
                <span className="text-xs text-muted-foreground">
                  {r.riders} rider{r.riders === 1 ? "" : "s"} · from {r.start}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${pct(r.completed + r.absent, r.riders)}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <Badge variant="outline">{r.waiting} waiting</Badge>
                {r.absent > 0 && <Badge variant="outline">{r.absent} absent</Badge>}
                <Badge variant="warning">{r.marking} being marked</Badge>
                <Badge variant="success">{r.completed} marked</Badge>
                {r.completed > 0 && (
                  <Badge variant="outline">
                    {r.passed} passed · {pct(r.passed, r.completed)}%
                  </Badge>
                )}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">Examiners: {r.pool.join(", ") || "—"}</div>
              {r.panel.length > 0 && (
                <div className="truncate text-xs text-muted-foreground">Panel: {r.panel.join(", ")}</div>
              )}
            </Link>
          ))}
        </CardContent>
      </Card>

      {canSchedule && (
        <Card>
          <CardContent className="flex flex-wrap items-start gap-2 py-3">
            {withResults === 0 ? (
              <RescheduleForm
                url={`/api/exam-days/${day.id}`}
                initialDate={day.date.toISOString().slice(0, 10)}
                initialTime={day.time}
                label="Move the day"
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                Riders already have results, so the day can&rsquo;t move — cancel the riders still waiting and book them
                onto a new day instead.
              </span>
            )}
            <CancelDayButton dayId={day.id} waiting={waitingTotal} withResults={withResults} />
            {lateRiders && (
              <AddLateRiders
                mode="day"
                dayId={day.id}
                levels={lateRiders.levels}
                levelsOnDay={Array.from(new Set(day.sittings.map((s) => s.level)))}
                examiners={lateRiders.examiners}
                riders={lateRiders.riders}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
