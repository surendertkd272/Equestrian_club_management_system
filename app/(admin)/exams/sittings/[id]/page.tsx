import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { requireSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { can } from "@/lib/permissions";
import { ExportCsvButton } from "@/components/ui/export-csv";
import { RescheduleForm, CancelSittingButton } from "../../exam-actions";
import { SittingRidersTable, PickNextButton } from "./riders-table";
import { PanelEditor, PoolEditor } from "../../panel-editor";
import { AddLateRiders } from "../../add-riders";
import { JudgeBadges, JudgeReadinessBanner, type JudgeRow } from "../../judge-readiness";
import { examinerReadiness } from "@/lib/examiner-readiness";
import { examinerLabel } from "@/lib/examiner-label";
import { sittingLabel } from "@/lib/exam-labels";
import { isExamManager } from "@/lib/exam-panel";
import { levelLadder, suggestedLevel } from "@/lib/exam-booking";
import { ENROLLED_RIDER_STATUSES } from "@/lib/rider-status";
import { OPEN_EXAM_STATUSES } from "@/lib/exam-schedule";
import { todayYmdForCentre } from "@/lib/centre-tz";

export const dynamic = "force-dynamic";

// COACH is not here: the page-access table (middleware) never lets a coach
// reach /exams/*, so listing them only suggested an access they don't have.
const CAN_VIEW = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "EXAMINER"];

// Marking queue for a sitting: pool of examiners + riders. Pool examiners pick
// (claim) an unassigned rider to mark; claimed riders lock to their examiner.
// Panel judges sit on every rider as co-judges and mark their own card.
export default async function SittingDetail({ params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!CAN_VIEW.includes(session.role)) redirect("/exams");

  const sitting = await prisma.examSitting.findUnique({
    where: { id: params.id },
    include: {
      examDay: { select: { id: true, name: true } },
      examiners: { orderBy: { examinerName: "asc" } },
      exams: {
        include: {
          rider: { select: { firstName: true, lastName: true, school: true, schoolRef: { select: { name: true } } } },
          judges: { where: { judgeId: session.userId }, select: { submittedAt: true } },
          horseAllocation: { select: { horse: { select: { name: true } } } },
        },
        orderBy: [{ runOrder: { sort: "asc", nulls: "last" } }, { rider: { firstName: "asc" } }],
      },
    },
  });
  if (!sitting) notFound();
  // HQ roles carry centreId = null, so this comparison 404'd ADMIN on every
  // one of these screens while org-fencing nobody. Same helper the API uses.
  if (await centreFence(session, sitting.centreId)) notFound();

  const isManager = ["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role);
  const inPool = sitting.examiners.some((e) => e.examinerId === session.userId);
  const onPanel = sitting.panelJudgeIds.includes(session.userId);
  // Examiners see the sittings they work — not every level's rider list.
  if (
    session.role === "EXAMINER" &&
    !inPool &&
    !onPanel &&
    !sitting.exams.some((e) => e.examinerId === session.userId || e.judges.length > 0)
  ) {
    redirect("/exams");
  }
  const unassigned = sitting.exams.filter((e) => !e.examinerId && e.status === "scheduled").length;
  const absentCount = sitting.exams.filter((e) => e.status === "absent").length;
  // Managers (anyone who can schedule exams) can move the sitting, cancel it,
  // or take a rider off it. A rider with a result on record stays put.
  const canSchedule = can(session.role, "exam.schedule");
  const canPanel = isExamManager(session.role);
  const hasResult = (e: (typeof sitting.exams)[number]) => e.status === "completed" || !!e.reopenedAt;
  const withResults = sitting.exams.filter(hasResult).length;
  const waiting = sitting.exams.length - withResults;
  const startTime = sitting.exams[0]?.time ?? "09:00";
  const upcoming = sitting.date.toISOString().slice(0, 10) >= (await todayYmdForCentre(sitting.centreId));

  const [template, judgeUsers, ladder] = await Promise.all([
    prisma.scoringTemplate.findUnique({
      where: { centreId_levelKey: { centreId: sitting.centreId, levelKey: String(sitting.level) } },
      select: { levelName: true },
    }),
    prisma.user.findMany({
      where: { id: { in: [...sitting.examiners.map((x) => x.examinerId), ...sitting.panelJudgeIds] } },
      select: { id: true, name: true, status: true, mustChangePassword: true, accessExpiresAt: true },
    }),
    canSchedule && upcoming ? levelLadder(prisma, sitting.centreId) : null,
  ]);
  const levelName = template?.levelName ?? `Level ${sitting.level}`;
  const title = sittingLabel(levelName, sitting.groupNo);
  const userById = new Map(judgeUsers.map((u) => [u.id, u]));
  const judgeRow = (id: string, name: string, panel: boolean): JudgeRow => {
    const u = userById.get(id);
    return {
      id,
      name: u?.name ?? name,
      you: id === session.userId,
      panel,
      readiness: u
        ? examinerReadiness(u, sitting.date)
        : { ok: false, label: "account removed", tone: "destructive" },
    };
  };
  const poolRows = sitting.examiners.map((x) => judgeRow(x.examinerId, x.examinerName, false));
  const panelRows = sitting.panelJudgeIds.map((id) => judgeRow(id, "Judge", true));

  // People who could join the panel: this centre's eligible, active judges
  // whose access lasts to the exam, not already in the pool or on the panel.
  const taken = new Set([...sitting.examiners.map((x) => x.examinerId), ...sitting.panelJudgeIds]);
  // Examiners who could join the pool: active, access lasting to the exam,
  // not already in it or on the panel.
  const poolCandidates = canSchedule
    ? (
        await prisma.user.findMany({
          where: {
            centreId: sitting.centreId,
            role: "EXAMINER",
            status: "active",
            OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gte: sitting.date } }],
          },
          select: { id: true, name: true, accessExpiresAt: true, mustChangePassword: true },
          orderBy: { name: "asc" },
        })
      )
        .filter((u) => !taken.has(u.id))
        .map((u) => ({ id: u.id, label: examinerLabel(u) }))
    : [];
  const panelCandidates = canPanel
    ? (
        await prisma.user.findMany({
          where: {
            centreId: sitting.centreId,
            role: { in: ["EXAMINER", "HEAD_COACH", "CENTRE_MANAGER"] },
            status: "active",
            OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gte: sitting.date } }],
          },
          select: { id: true, name: true, accessExpiresAt: true, mustChangePassword: true },
          orderBy: { name: "asc" },
        })
      )
        .filter((u) => !taken.has(u.id))
        .map((u) => ({ id: u.id, label: examinerLabel(u) }))
    : [];

  const lateRiders = ladder
    ? (
        await prisma.rider.findMany({
          where: {
            centreId: sitting.centreId,
            status: { in: [...ENROLLED_RIDER_STATUSES] },
            exams: { none: { level: sitting.level, status: { in: OPEN_EXAM_STATUSES } } },
          },
          select: { id: true, firstName: true, lastName: true, currentLevel: true, school: true, schoolRef: { select: { name: true } } },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
      ).map((r) => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
        school: r.schoolRef?.name ?? r.school ?? "",
        currentLevel: r.currentLevel,
        suggested: suggestedLevel(ladder, r.currentLevel),
      }))
    : [];

  const rows = sitting.exams.map((e) => ({
    id: e.id,
    name: `${e.rider.firstName} ${e.rider.lastName}`,
    school: e.rider.schoolRef?.name ?? e.rider.school ?? "",
    state:
      e.status === "completed"
        ? ("completed" as const)
        : e.status === "absent"
          ? ("absent" as const)
          : !e.examinerId
            ? ("unassigned" as const)
            : ("marking" as const),
    time: sitting.slotMinutes ? e.time : null,
    runOrder: sitting.slotMinutes ? e.runOrder : null,
    horse: e.horseAllocation?.horse.name ?? null,
    canMarkAbsent: canSchedule || inPool,
    examinerName: e.examinerName,
    mine: e.examinerId === session.userId,
    myCard: e.judges[0] ? (e.judges[0].submittedAt ? ("done" as const) : ("todo" as const)) : null,
    passed: e.passed,
    canRemove: canSchedule && !hasResult(e),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Exam sitting — {title}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(sitting.date)} · {sitting.exams.length} rider{sitting.exams.length === 1 ? "" : "s"} ·{" "}
          {unassigned} waiting{absentCount ? ` · ${absentCount} absent` : ""}
          {sitting.slotMinutes ? ` · ${sitting.slotMinutes}-minute slots` : ""}
        </p>
        {sitting.examDay && (
          <p className="mt-1 text-sm">
            Part of{" "}
            <Link href={`/exams/days/${sitting.examDay.id}`} className="text-primary underline">
              {sitting.examDay.name}
            </Link>
          </p>
        )}
        {sitting.notes && <p className="mt-1 text-sm">{sitting.notes}</p>}
        {canSchedule && (
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <ExportCsvButton entity="exams" label="Export results" query={`sittingId=${sitting.id}`} />
            {/* A sitting inside an exam day moves with its day. */}
            {withResults === 0 && !sitting.examDay && (
              <RescheduleForm
                url={`/api/exam-sittings/${sitting.id}`}
                initialDate={sitting.date.toISOString().slice(0, 10)}
                initialTime={startTime}
                label="Change date / time"
              />
            )}
            <CancelSittingButton sittingId={sitting.id} waiting={waiting} withResults={withResults} />
            <Link
              href={`/exams/sittings/${sitting.id}/order`}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
            >
              Running order &amp; horses
            </Link>
            {ladder && (
              <AddLateRiders mode="sitting" sittingId={sitting.id} level={sitting.level} levelName={title} riders={lateRiders} />
            )}
          </div>
        )}
      </div>

      {upcoming && <JudgeReadinessBanner judges={[...poolRows, ...panelRows]} canManage={isExamManager(session.role)} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Examiner Pool</CardTitle>
          <CardDescription>Each examiner picks a rider from the queue and leads their card.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <JudgeBadges judges={poolRows} />
          {canSchedule && (
            <PoolEditor
              sittingId={sitting.id}
              pool={poolRows.map((j) => ({ id: j.id, name: j.name }))}
              candidates={poolCandidates}
            />
          )}
        </CardContent>
      </Card>

      {(canPanel || panelRows.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Jury panel</CardTitle>
            <CardDescription>
              Judges who co-judge every rider in this sitting, alongside whichever examiner leads. Each rider&rsquo;s
              result is the mean of every card, and completes when the last card is in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {panelRows.length > 0 ? (
              <JudgeBadges judges={panelRows} />
            ) : (
              <p className="text-xs text-muted-foreground">No panel — each rider is marked by their lead examiner alone.</p>
            )}
            {canPanel && (
              <PanelEditor
                sittingId={sitting.id}
                panel={panelRows.map((j) => ({ id: j.id, name: j.name }))}
                candidates={panelCandidates}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riders</CardTitle>
          {inPool && unassigned > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <PickNextButton sittingId={sitting.id} />
              <p className="text-xs text-muted-foreground">
                {sitting.slotMinutes ? "Takes the next rider in the running order" : "Or pick a rider below"} — it
                locks to you.
              </p>
            </div>
          )}
          {onPanel && (
            <p className="text-xs text-muted-foreground">You&rsquo;re on this sitting&rsquo;s panel — mark your card for each rider.</p>
          )}
        </CardHeader>
        <CardContent>
          <SittingRidersTable rows={rows} inPool={inPool} isManager={isManager} />
        </CardContent>
      </Card>
    </div>
  );
}
