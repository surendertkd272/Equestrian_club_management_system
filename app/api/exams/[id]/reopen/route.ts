import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { notifyMany } from "@/lib/notify";
import { ExamPanelError, isExamManager, lockExam } from "@/lib/exam-panel";

const schema = z.object({
  reason: z.string().trim().min(5, "Say why the result needs correcting (at least 5 characters).").max(300),
});

// Reopen a completed exam so a mistake in the marks can be corrected.
//
// A completed exam used to be final for everyone, Super Admin included: a
// mis-tapped score or the wrong rider's card could only be "fixed" by revoking
// the certificate and booking a whole new sitting, which recorded a fake
// second attempt. Reopening unlocks every card on the panel (marks are kept,
// so judges correct rather than re-mark from scratch) and the exam completes
// again through the normal path when the last card is re-submitted. The
// certificate stays as it is until then: kept if the corrected result is still
// a pass, revoked if it is not (lib/exam-panel.ts).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isExamManager(session.role)) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Only a centre manager or HQ admin can reopen a completed exam." },
      { status: 403 },
    );
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Give a reason for reopening.";
    return NextResponse.json({ error: "VALIDATION", message }, { status: 400 });
  }

  const exam = await prisma.exam.findUnique({ where: { id: params.id }, select: { id: true, centreId: true } });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, exam.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }

  let before: { status: string; totalScore: number | null; passed: boolean | null };
  let panel: { examinerId: string | null; judgeIds: string[]; level: number; riderId: string };
  try {
    ({ before, panel } = await prisma.$transaction(async (tx) => {
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
          reopenReason: parsed.data.reason,
        },
      });
      await tx.examJudge.updateMany({ where: { examId: fresh.id }, data: { submittedAt: null } });
      return {
        before: { status: fresh.status, totalScore: fresh.totalScore, passed: fresh.passed },
        panel: {
          examinerId: fresh.examinerId,
          judgeIds: fresh.judges.map((j) => j.judgeId),
          level: fresh.level,
          riderId: fresh.riderId,
        },
      };
    }));
  } catch (e) {
    if (e instanceof ExamPanelError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }

  await audit({
    userId: session.userId,
    action: "exam.reopened",
    tableName: "exam",
    rowId: exam.id,
    before,
    after: { status: "in_progress", reason: parsed.data.reason },
  });

  // Tell the jury their cards are open again.
  const jury = [panel.examinerId, ...panel.judgeIds].filter(
    (id): id is string => !!id && id !== session.userId,
  );
  if (jury.length > 0) {
    await notifyMany(jury, {
      centreId: exam.centreId,
      type: "exam.reopened",
      title: `Level ${panel.level} exam reopened for correction`,
      body: `Reason: ${parsed.data.reason}. Correct your card and submit it again.`,
      link: `/exams/${exam.id}`,
    });
  }

  return NextResponse.json({ ok: true });
}
