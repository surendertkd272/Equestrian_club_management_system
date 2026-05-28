import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { parseRubric } from "@/lib/schemas/exam";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExamScorer } from "./scorer";
import { JudgesPanel } from "./judges-panel";
import { SupportStaffPanel } from "./support-staff-panel";
import { AttachmentsPanel } from "./attachments-panel";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ExamPage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  if (!can(session.role, "exam.score")) redirect("/exams");
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
    },
  });
  if (!exam) notFound();
  if (centreId && exam.centreId !== centreId) notFound();
  // EXAMINER can see the exam if they're the lead OR a registered co-judge.
  const isLeadOrJudge =
    exam.examinerId === session.userId ||
    exam.judges.some((j) => j.judgeId === session.userId);
  if (session.role === "EXAMINER" && !isLeadOrJudge) redirect("/exams");

  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
  });

  const rubric = template ? parseRubric(template.categoriesJson) : [];
  // If a co-judge is viewing, load their own card; otherwise fall back to
  // the lead's scoresJson on the exam row.
  const myJudgeRow =
    session.role === "EXAMINER" && exam.examinerId !== session.userId
      ? exam.judges.find((j) => j.judgeId === session.userId)
      : null;
  // scoresJson is a native jsonb column — Prisma returns the parsed object,
  // so no JSON.parse here. Narrow to a plain object before treating as a
  // record (a malformed legacy value could in theory be a primitive/array,
  // which we drop to {}).
  const asScores = (v: unknown): Record<string, number | string> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return v as Record<string, number | string>;
  };
  const initialScores: Record<string, number | string> = myJudgeRow?.scoresJson
    ? asScores(myJudgeRow.scoresJson)
    : asScores(exam.scoresJson);
  const canEditAdjustments =
    session.role === "SUPER_ADMIN" ||
    session.role === "CENTRE_MANAGER" ||
    (session.role === "EXAMINER" && exam.examinerId === session.userId);

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
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/exams">
            <ChevronLeft className="h-4 w-4" /> Back to exams
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/exams/${exam.id}/test-sheet`} target="_blank" rel="noopener">
              📄 Print judge sheet
            </a>
          </Button>
          <Badge variant={exam.status === "completed" ? "success" : exam.status === "in_progress" ? "warning" : "outline"}>
            {exam.status.replace("_", " ")}
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
                {template?.levelName ?? `Level ${exam.level}`} · {formatDate(exam.date)} {exam.time} · Examiner:{" "}
                {exam.examinerName}
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
            <div className="rounded-md border bg-blue-50 p-3 text-sm">
              <div className="mb-2 text-xs font-bold uppercase text-blue-700">
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

      {exam.previousExam && (
        <Card className="border-amber-300 bg-amber-50">
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
        leadExaminerId={exam.examinerId}
        leadExaminerName={exam.examinerName}
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
      ) : (
        <ExamScorer
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
