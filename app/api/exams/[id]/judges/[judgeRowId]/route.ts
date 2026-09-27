import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import {
  ExamPanelError,
  lockExam,
  completeIfPanelDone,
  afterExamCompleted,
  type FinalizeResult,
  type LockedExam,
} from "@/lib/exam-panel";

// DELETE — remove a co-judge from an exam. The lead examiner is never on
// this table (they're implicit at position 1) so this only ever removes a
// position-≥2 row.
//
// The exam completes when the last card on the panel is submitted, so taking
// off a judge who never turned up can be what completes it: if every
// remaining card is already in, the exam is finalised here, exactly as if the
// last judge had pressed Submit.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; judgeRowId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const row = await prisma.examJudge.findUnique({
    where: { id: params.judgeRowId },
    include: { exam: { select: { id: true, centreId: true, status: true } } },
  });
  if (!row || row.examId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // HQ roles carry centreId = null, so a hand-rolled comparison locked ADMIN
  // out of every centre while org-fencing nobody. centreFence does both.
  const fence42 = await centreFence(session, row.exam.centreId);
  if (fence42) {
    return NextResponse.json({ error: fence42 }, { status: 403 });
  }

  let locked: LockedExam;
  let completion: FinalizeResult | null;
  try {
    ({ locked, completion } = await prisma.$transaction(async (tx) => {
      const fresh = await lockExam(tx, row.examId);
      if (!fresh) throw new ExamPanelError("NOT_FOUND", "This exam no longer exists.", 404);
      if (fresh.status === "completed") {
        throw new ExamPanelError("ALREADY_COMPLETED", "This exam is already completed.", 409);
      }
      await tx.examJudge.delete({ where: { id: row.id } });
      const after = (await lockExam(tx, row.examId))!;
      return { locked: after, completion: await completeIfPanelDone(tx, after, session.userId) };
    }));
  } catch (e) {
    if (e instanceof ExamPanelError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }

  await audit({
    userId: session.userId,
    action: "exam.judge_removed",
    tableName: "examJudge",
    rowId: row.id,
    before: { examId: row.examId, judgeId: row.judgeId },
    after: completion ? { examCompleted: true, totalScore: completion.total, passed: completion.passed } : undefined,
  });
  if (completion) {
    await afterExamCompleted(locked, completion, session.userId);
  }
  return NextResponse.json({ ok: true, completed: completion !== null });
}
