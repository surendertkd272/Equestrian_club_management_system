import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyMany } from "@/lib/notify";
import { ExamPanelError, lockExam } from "@/lib/exam-panel";

// How long after the exam a family may ask for its result to be reviewed.
export const REVIEW_WINDOW_DAYS = 30;

// Reopen a completed exam so a mistake in the marks can be corrected. Shared
// by the manager's "Reopen for correction" and a family's review request.
//
// Reopening unlocks every card on the panel (marks are kept, so judges correct
// rather than re-mark from scratch) and the exam completes again through the
// normal path when the last card is re-submitted. The certificate stays as it
// is until then: kept if the corrected result is still a pass, revoked if it
// is not (lib/exam-panel.ts). Callers check the role and the centre fence.
export async function reopenExam(session: SessionPayload, examId: string, reason: string): Promise<void> {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { id: true, centreId: true } });
  if (!exam) throw new ExamPanelError("NOT_FOUND", "This exam no longer exists.", 404);
  const { before, panel } = await prisma.$transaction(async (tx) => {
    const fresh = await lockExam(tx, exam.id);
    if (!fresh) throw new ExamPanelError("NOT_FOUND", "This exam no longer exists.", 404);
    if (fresh.status !== "completed") {
      throw new ExamPanelError("NOT_COMPLETED", "Only a completed exam can be reopened — this one is still open for marking.", 409);
    }
    await tx.exam.update({
      where: { id: fresh.id },
      data: {
        status: "in_progress",
        passed: null,
        leadSubmittedAt: null,
        reopenedAt: new Date(),
        reopenedBy: session.userId,
        reopenReason: reason,
      },
    });
    await tx.examJudge.updateMany({ where: { examId: fresh.id }, data: { submittedAt: null } });
    return {
      before: { status: fresh.status, totalScore: fresh.totalScore, passed: fresh.passed },
      panel: { examinerId: fresh.examinerId, judgeIds: fresh.judges.map((j) => j.judgeId), level: fresh.level },
    };
  });
  await audit({
    userId: session.userId,
    action: "exam.reopened",
    tableName: "exam",
    rowId: exam.id,
    before,
    after: { status: "in_progress", reason },
  });
  // Tell the jury their cards are open again.
  const jury = [panel.examinerId, ...panel.judgeIds].filter((id): id is string => !!id && id !== session.userId);
  if (jury.length > 0) {
    await notifyMany(jury, {
      centreId: exam.centreId,
      type: "exam.reopened",
      title: `Level ${panel.level} exam reopened for correction`,
      body: `Reason: ${reason}. Correct your card and submit it again.`,
      link: `/exams/${exam.id}`,
    });
  }
}
