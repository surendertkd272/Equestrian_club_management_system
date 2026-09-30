import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isReadOnly } from "@/lib/roles";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { parseRubric } from "@/lib/schemas/exam";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExamScorer } from "./scorer";
import { AbsentToggle } from "./absent-toggle";
import { ReviewDecision } from "./review-decision";
import { JudgesPanel } from "./judges-panel";
import { SupportStaffPanel } from "./support-staff-panel";
import { AttachmentsPanel } from "./attachments-panel";
import { ReopenExamButton, RescheduleForm, RemoveExamButton } from "../exam-actions";
import { isExamManager, pendingCards } from "@/lib/exam-panel";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

export default async function ExamPage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  // Read-only roles (SCHOOL_ADMINISTRATOR) see exam detail without the
  // ability to score. Everyone else needs exam.score to land here.
  const readOnly = isReadOnly(session.role);
  if (!can(session.role, "exam.score") && !readOnly) redirect("/exams");
  const centreId = scopeCentre(session);

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    include: {
      rider: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          currentLevel: true,
          dob: true,
        },
      },
      judges: { orderBy: { position: "asc" } },
      attachments: { orderBy: { uploadedAt: "desc" } },
      previousExam: { select: { id: true, attemptNumber: true, passed: true, totalScore: true, date: true } },
      _count: { select: { certificates: true } },
      horseAllocation: { select: { horse: { select: { name: true } } } },
      sitting: { select: { slotMinutes: true, examiners: { select: { examinerId: true } } } },
      reviewRequests: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!exam) notFound();
  if (centreId && exam.centreId !== centreId) notFound();
  // HQ users (SUPER_ADMIN/ADMIN) have centreId=null, so the centre check above
  // is skipped — bound them to their own org so they can't open another org's
  // exam by id.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  if ((await getOrgIdForCentre(exam.centreId)) !== orgId) notFound();
  // EXAMINER can see the exam if they're the lead OR a registered co-judge.
  const isLeadOrJudge =
    exam.examinerId === session.userId ||
    exam.judges.some((j) => j.judgeId === session.userId);
  if (session.role === "EXAMINER" && !isLeadOrJudge) redirect("/exams");

  // Always fetch the live template (needed for passThreshold + levelName),
  // but render the rubric itself from the exam's snapshot when present so
  // an admin's mid-exam rubric edit doesn't change the categories under
  // the examiner's feet.
  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
  });
  const rubric = exam.rubricSnapshotJson
    ? parseRubric(exam.rubricSnapshotJson)
    : template
      ? parseRubric(template.categoriesJson)
      : [];
  // A co-judge viewing gets their own card, whatever their role — a head coach
  // or manager seated on the jury used to be handed the LEAD's card, and
  // saving it overwrote the lead examiner's marks. Anyone else (the lead, or
  // a manager acting for them) works on the lead's scoresJson.
  const myJudgeRow =
    exam.examinerId !== session.userId ? exam.judges.find((j) => j.judgeId === session.userId) ?? null : null;
  const cardSubmitted = myJudgeRow ? !!myJudgeRow.submittedAt : !!exam.leadSubmittedAt;
  const waitingFor = exam.status === "completed" ? [] : pendingCards(exam);
  const isManager = isExamManager(session.role);
  const canSchedule = can(session.role, "exam.schedule") && !readOnly;
  const isOpen = exam.status !== "completed";
  const hasResult = !!exam.reopenedAt || exam._count.certificates > 0;
  const riderName = `${exam.rider.firstName} ${exam.rider.lastName}`;
  // scoresJson is a native jsonb column — Prisma returns the parsed object,
  // so no JSON.parse here. Narrow to a plain object before treating as a
  // record (a malformed legacy value could in theory be a primitive/array,
  // which we drop to {}).
  const asScores = (v: unknown): Record<string, number | string> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return v as Record<string, number | string>;
  };
  // A co-judge starts from THEIR card, even when it is still empty. Falling
  // back to the lead's marks pre-filled a fresh co-judge card with the lead's
  // scores, so an untouched card was submitted as an exact copy of the lead's.
  const initialScores: Record<string, number | string> = myJudgeRow
    ? asScores(myJudgeRow.scoresJson)
    : asScores(exam.scoresJson);
  // Deductions and time faults are the lead examiner's (or a manager's) —
  // never a co-judge's, who marks their own rubric card only.
  const canEditAdjustments = isManager || exam.examinerId === session.userId;
  const inPool = !!exam.sitting?.examiners.some((x) => x.examinerId === session.userId);
  const canMarkAbsent =
    !readOnly && (canSchedule || inPool) && (exam.status === "absent" || (isOpen && !hasResult));

  const otherExams = await prisma.exam.findMany({
    where: {
      riderId: exam.riderId,
      examinerId: exam.examinerId,
      id: { not: exam.id },
    },
    select: { id: true, level: true, status: true },
    orderBy: { level: "asc" },
    take: 12,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/exams">
            <ChevronLeft className="h-4 w-4" /> Back to exams
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/exams/${exam.id}/test-sheet`} target="_blank" rel="noopener">
              📄 Print jury sheet
            </a>
          </Button>
          <Badge variant={exam.status === "completed" ? "success" : exam.status === "in_progress" ? "warning" : "outline"}>
            {formatEnum(exam.status)}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {exam.rider.firstName} {exam.rider.lastName}
              </CardTitle>
              <CardDescription>
                {template?.levelName ?? `Level ${exam.level}`} · {formatDate(exam.date)} {exam.time}
                {exam.runOrder ? ` (#${exam.runOrder} in the order)` : ""} · Examiner: {exam.examinerName ?? "not picked yet"}
                {exam.horseAllocation ? ` · Horse: ${exam.horseAllocation.horse.name}` : ""}
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Pass mark</div>
              <div className="text-2xl font-bold">{template?.passThreshold ?? "—"}%</div>
            </div>
          </div>
        </CardHeader>
        {otherExams.length > 0 && (
          <CardContent>
            <div className="rounded-md border bg-info-soft p-3 text-sm">
              <div className="mb-2 text-xs font-bold uppercase text-info-foreground">
                Other exams for this rider with you
              </div>
              <div className="flex flex-wrap gap-1.5">
                {otherExams.map((o) => (
                  <Link
                    key={o.id}
                    href={`/exams/${o.id}`}
                    className="rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted"
                  >
                    Level {o.level} {o.status === "completed" ? "✓" : o.status === "in_progress" ? "…" : ""}
                  </Link>
                ))}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {exam.reviewRequests.map((r) => (
        <Card key={r.id} className={r.status === "open" ? "border-warning/40 bg-warning-soft" : ""}>
          <CardContent className="space-y-2 py-3 text-sm">
            <div>
              <span className="font-semibold">
                {r.status === "open" ? "The family asked for this result to be reviewed" : r.status === "reopened" ? "Reopened after a review request" : "Review request declined"}
              </span>{" "}
              <span className="text-xs text-muted-foreground">({formatDate(r.createdAt)})</span>
            </div>
            <p>“{r.reason}”</p>
            {r.response && <p className="text-xs text-muted-foreground">Reply: {r.response}</p>}
            {r.status === "open" && isManager && exam.status === "completed" && <ReviewDecision examId={exam.id} requestId={r.id} />}
          </CardContent>
        </Card>
      ))}

      {exam.status === "absent" && (
        <Card className="border-warning/30 bg-warning-soft">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span>
              <span className="font-semibold">Absent</span>
              {exam.absentAt ? <> — marked {formatDate(exam.absentAt)}</> : null}
              {exam.absentReason ? <>: {exam.absentReason}</> : null}. The rider can be booked onto another exam.
            </span>
            {canMarkAbsent && <AbsentToggle examId={exam.id} absent />}
          </CardContent>
        </Card>
      )}

      {exam.reopenedAt && (
        <Card className="border-warning/30 bg-warning-soft">
          <CardContent className="py-3 text-sm">
            <span className="font-semibold">Reopened for correction</span> on {formatDate(exam.reopenedAt)}
            {exam.reopenReason ? <> — {exam.reopenReason}</> : null}.
            {isOpen && " The result stands until every judge re-submits their card."}
          </CardContent>
        </Card>
      )}

      {((isOpen && canSchedule && !hasResult) || (!isOpen && isManager)) && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            {!isOpen ? (
              <ReopenExamButton examId={exam.id} />
            ) : exam.sittingId ? (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/exams/sittings/${exam.sittingId}`}>Open sitting</Link>
                </Button>
                {canMarkAbsent && exam.status !== "absent" && <AbsentToggle examId={exam.id} absent={false} />}
                <RemoveExamButton
                  examId={exam.id}
                  riderName={riderName}
                  inSitting
                  afterRemove={`/exams/sittings/${exam.sittingId}`}
                />
              </>
            ) : (
              <>
                <RescheduleForm
                  url={`/api/exams/${exam.id}`}
                  initialDate={exam.date.toISOString().slice(0, 10)}
                  initialTime={exam.time}
                  label="Reschedule"
                />
                <RemoveExamButton examId={exam.id} riderName={riderName} inSitting={false} afterRemove="/exams" />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {exam.previousExam && (
        <Card className="border-warning/30 bg-warning-soft">
          <CardContent className="py-3 text-sm">
            <span className="font-semibold">Attempt {exam.attemptNumber}.</span>{" "}
            Previous attempt on {formatDate(exam.previousExam.date)} —{" "}
            {exam.previousExam.passed === true ? "passed" : "did not pass"}
            {typeof exam.previousExam.totalScore === "number" && ` (${exam.previousExam.totalScore})`}.{" "}
            <Link href={`/exams/${exam.previousExam.id}`} className="text-primary underline">
              View →
            </Link>
          </CardContent>
        </Card>
      )}

      <JudgesPanel
        examId={exam.id}
        leadExaminerId={exam.examinerId ?? ""}
        leadExaminerName={exam.examinerName ?? "Unassigned"}
        leadSubmitted={!!exam.leadSubmittedAt}
        completed={exam.status === "completed"}
        canManage={session.role === "SUPER_ADMIN" || session.role === "CENTRE_MANAGER"}
        judges={exam.judges.map((j) => ({
          id: j.id,
          judgeId: j.judgeId,
          judgeName: j.judgeName,
          position: j.position,
          submittedAt: j.submittedAt?.toISOString() ?? null,
          subTotal: j.subTotal,
        }))}
      />

      <SupportStaffPanel
        examId={exam.id}
        canManage={session.role === "SUPER_ADMIN" || session.role === "CENTRE_MANAGER" || (session.role === "EXAMINER" && exam.examinerId === session.userId)}
        initialJson={exam.supportStaffJson}
      />

      {!template ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No scoring template exists for Level {exam.level}.{" "}
            {session.role === "SUPER_ADMIN" && (
              <Link href="/exams/templates" className="text-primary underline">
                Create one
              </Link>
            )}
          </CardContent>
        </Card>
      ) : readOnly ? (
        // SCHOOL_ADMINISTRATOR sees a results summary, not the scoring UI.
        // The rubric categories + totals are surfaced for transparency;
        // for the rider's narrative report they go to /reports.
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              Status: <Badge variant={exam.status === "completed" ? "success" : "outline"}>{formatEnum(exam.status)}</Badge>
              {exam.totalScore !== null && (
                <> · Total: <b>{exam.totalScore}</b> / pass {template.passThreshold}%</>
              )}
              {exam.passed === true && <> · <Badge variant="success">Passed</Badge></>}
              {exam.passed === false && <> · <Badge variant="destructive">Did not pass</Badge></>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              For the full rider narrative, see{" "}
              <Link href={`/reports/${exam.riderId}`} className="text-primary underline">
                the rider's report
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : exam.status === "absent" ? null : (
        <ExamScorer
          cardKey={`${exam.id}:${myJudgeRow ? myJudgeRow.judgeId : "lead"}:${session.userId}`}
          examId={exam.id}
          status={exam.status}
          rubric={rubric}
          initialScores={initialScores}
          passThreshold={template.passThreshold}
          level={exam.level}
          judgeId={myJudgeRow?.judgeId ?? null}
          initialDeductions={exam.deductions}
          initialTimeFaults={exam.timeFaults}
          canEditAdjustments={canEditAdjustments}
          cardSubmitted={cardSubmitted}
          waitingFor={waitingFor}
          canReopen={isManager}
        />
      )}

      <AttachmentsPanel
        examId={exam.id}
        canManage={canEditAdjustments}
        initial={exam.attachments.map((a) => ({
          id: a.id,
          kind: a.kind,
          url: a.url,
          caption: a.caption,
          uploadedAt: a.uploadedAt.toISOString(),
        }))}
      />

      {exam.status === "completed" && (
        <Card>
          <CardContent className="flex items-center justify-between py-3">
            <span className="text-sm text-muted-foreground">Rider-facing result card</span>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/exams/${exam.id}/result-sheet`} target="_blank" rel="noopener">
                📄 Print result
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
