import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { BookingError, panelJudges, seatPanelTx } from "@/lib/exam-booking";
import { OPEN_EXAM_STATUSES } from "@/lib/exam-schedule";
import {
  ExamPanelError,
  afterExamCompleted,
  completeIfPanelDone,
  isExamManager,
  lockExam,
  type FinalizeResult,
  type LockedExam,
} from "@/lib/exam-panel";

// A sitting's jury panel: judges seated as co-judges on EVERY rider in the
// sitting, on top of whichever pool examiner leads each one. Co-judges used to
// be added one exam at a time, so a three-judge panel over a 120-rider level
// meant 240 separate additions. Riders added to the sitting later are seated
// with the panel too (lib/exam-booking addExamsToSittingTx).
const addSchema = z.object({ judgeIds: z.array(z.string().min(1)).min(1).max(12) });
const removeSchema = z.object({ judgeId: z.string().min(1) });

async function guard(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!isExamManager(session.role)) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return { error: readOnlyBlock };
  const sitting = await prisma.examSitting.findUnique({
    where: { id },
    select: {
      id: true, centreId: true, date: true, panelJudgeIds: true,
      examiners: { select: { examinerId: true } },
    },
  });
  if (!sitting) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const fence = await centreFence(session, sitting.centreId);
  if (fence) return { error: NextResponse.json({ error: fence }, { status: 403 }) };
  return { session, sitting };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if (g.error) return g.error;
  const { session, sitting } = g;
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  try {
    const judges = await panelJudges(prisma, session, sitting.centreId, parsed.data.judgeIds, {
      examDate: sitting.date,
      poolIds: sitting.examiners.map((x) => x.examinerId),
    });
    const fresh = judges.filter((j) => !sitting.panelJudgeIds.includes(j.id));
    const seated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExamSitting" WHERE id = ${sitting.id} FOR UPDATE`;
      await tx.examSitting.update({
        where: { id: sitting.id },
        data: { panelJudgeIds: [...sitting.panelJudgeIds, ...fresh.map((j) => j.id)] },
      });
      const open = await tx.exam.findMany({
        where: { sittingId: sitting.id, status: { in: OPEN_EXAM_STATUSES } },
        select: { id: true },
      });
      return seatPanelTx(tx, open.map((e) => e.id), fresh);
    });
    await audit({
      userId: session.userId,
      action: "exam.sitting_panel_added",
      tableName: "examSitting",
      rowId: sitting.id,
      after: { judgeIds: fresh.map((j) => j.id), cardsSeated: seated },
    });
    return NextResponse.json({ ok: true, added: fresh.length, cardsSeated: seated });
  } catch (e) {
    if (e instanceof BookingError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }
}

// Take a judge off the panel. Their cards still to be marked come off every
// open exam; a card they already submitted stays — those marks stand. Removing
// the last outstanding card completes that exam, exactly as the per-exam
// "remove co-judge" does.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if (g.error) return g.error;
  const { session, sitting } = g;
  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const { judgeId } = parsed.data;

  await prisma.examSitting.update({
    where: { id: sitting.id },
    data: { panelJudgeIds: sitting.panelJudgeIds.filter((id) => id !== judgeId) },
  });
  const cards = await prisma.examJudge.findMany({
    where: { judgeId, submittedAt: null, exam: { sittingId: sitting.id, status: { not: "completed" } } },
    select: { id: true, examId: true },
  });
  const completed: { locked: LockedExam; completion: FinalizeResult }[] = [];
  for (const card of cards) {
    try {
      const r = await prisma.$transaction(async (tx) => {
        const fresh = await lockExam(tx, card.examId);
        if (!fresh || fresh.status === "completed") return null;
        await tx.examJudge.deleteMany({ where: { id: card.id, submittedAt: null } });
        const after = (await lockExam(tx, card.examId))!;
        const completion = await completeIfPanelDone(tx, after, session.userId);
        return completion ? { locked: after, completion } : null;
      });
      if (r) completed.push(r);
    } catch (e) {
      if (!(e instanceof ExamPanelError)) throw e;
      // One exam refusing to finalise (e.g. no public URL for its certificate)
      // must not stop the judge coming off the rest; that exam stays open.
      console.warn("[panel] couldn't complete exam after removing judge", card.examId, e.code);
    }
  }
  const kept = await prisma.examJudge.count({ where: { judgeId, exam: { sittingId: sitting.id } } });
  await audit({
    userId: session.userId,
    action: "exam.sitting_panel_removed",
    tableName: "examSitting",
    rowId: sitting.id,
    before: { judgeId },
    after: { cardsRemoved: cards.length, cardsKept: kept, examsCompleted: completed.length },
  });
  for (const c of completed) await afterExamCompleted(c.locked, c.completion, session.userId);
  return NextResponse.json({ ok: true, cardsRemoved: cards.length, cardsKept: kept, examsCompleted: completed.length });
}
