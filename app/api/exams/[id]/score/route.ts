import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { updateExamScoreSchema, parseRubric, computeTotal, findScoreViolations, countUnscored } from "@/lib/schemas/exam";
import { audit } from "@/lib/audit";
import {
  ExamPanelError,
  isExamManager,
  lockExam,
  pendingCards,
  panelAggregate,
  adjustedTotal,
  completeIfPanelDone,
  afterExamCompleted,
  type FinalizeResult,
  type LockedExam,
} from "@/lib/exam-panel";

const COMPLETED_MESSAGE =
  "This exam is already completed. A centre manager can reopen it for correction from the exam page.";
const CARD_LOCKED_MESSAGE =
  "This card is already submitted and locked. It can only change if a manager reopens the exam after it completes.";

// Which card a request is about, and whether the caller may write it.
// A co-judge's card is addressed by `judgeId`; no judgeId means the lead
// examiner's card (Exam.scoresJson). Only the card's own judge, or a manager
// acting for them, may touch it — a head coach seated as co-judge who saved
// without a judgeId used to overwrite the LEAD's marks.
function resolveCard(
  session: { userId: string; role: string },
  exam: { examinerId: string | null; judges: { judgeId: string }[] },
  judgeId: string | undefined,
): { error: NextResponse } | { judgeId: string | null } {
  const isManager = isExamManager(session.role);
  if (judgeId) {
    if (!exam.judges.some((j) => j.judgeId === judgeId)) {
      return { error: NextResponse.json({ error: "JUDGE_NOT_ON_EXAM" }, { status: 400 }) };
    }
    if (!isManager && session.userId !== judgeId) {
      return { error: NextResponse.json({ error: "NOT_YOUR_CARD" }, { status: 403 }) };
    }
    return { judgeId };
  }
  if (!isManager && exam.examinerId !== session.userId) {
    const seated = exam.judges.some((j) => j.judgeId === session.userId);
    return {
      error: NextResponse.json(
        {
          error: seated ? "NOT_YOUR_CARD" : "NOT_YOUR_EXAM",
          message: seated
            ? "You're on this exam's jury — mark your own card, not the lead examiner's. Reload the page to open it."
            : "Only the lead examiner or a centre manager can mark this card.",
        },
        { status: 403 },
      ),
    };
  }
  return { judgeId: null };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.score")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateExamScoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const { scores, final, judgeId, deductions, timeFaults, allowIncomplete } = parsed.data;

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    include: { judges: true },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so a hand-rolled comparison locked ADMIN
  // out of every centre while org-fencing nobody. centreFence does both.
  const fence = await centreFence(session, exam.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }
  const card = resolveCard(session, exam, judgeId);
  if ("error" in card) return card.error;
  const isCoJudgeCard = card.judgeId !== null;
  // Deductions and time faults belong to the lead examiner (or a manager); a
  // co-judge marks their own rubric card only.
  const mayAdjust = !isCoJudgeCard || isExamManager(session.role);

  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
  });
  if (!template) return NextResponse.json({ error: "NO_TEMPLATE_FOR_LEVEL" }, { status: 400 });
  // Mark against the rubric the exam was scheduled with, so a mid-exam rubric
  // edit doesn't change the rules under the examiner's feet. Exams created
  // before snapshots existed are pinned on their first save (below).
  const rubric = parseRubric(exam.rubricSnapshotJson ?? template.categoriesJson);

  // Reject any per-item score outside its rubric [0, max] before aggregating —
  // an over-max entry would inflate the total past `max` and could flip a fail
  // into a pass (and auto-issue a certificate).
  const violations = findScoreViolations(rubric, scores);
  if (violations.length > 0) {
    return NextResponse.json({ error: "SCORE_OUT_OF_RANGE", violations }, { status: 400 });
  }

  // Locking a half-filled card is almost always a slip, and it is irreversible:
  // unscored items count as zero. Refuse unless the examiner has explicitly
  // confirmed a partial card.
  if (final && !allowIncomplete) {
    const { unscored, total: itemCount } = countUnscored(rubric, scores);
    if (unscored > 0) {
      return NextResponse.json(
        {
          error: "INCOMPLETE_CARD",
          unscored,
          itemCount,
          message: `${unscored} of ${itemCount} rubric items have no score. Unscored items count as zero, so submitting now would record a lower result than the rider earned.`,
        },
        { status: 400 },
      );
    }
  }

  const { total: cardTotal, max } = computeTotal(rubric, scores);

  let outcome: {
    locked: LockedExam;
    completion: FinalizeResult | null;
    provisionalTotal: number;
  };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // Re-read under a row lock: every guard below must hold at write time,
      // not at the moment the request arrived.
      const fresh = await lockExam(tx, exam.id);
      if (!fresh) throw new ExamPanelError("NOT_FOUND", "This exam no longer exists.", 404);
      if (fresh.status === "completed") throw new ExamPanelError("ALREADY_COMPLETED", COMPLETED_MESSAGE, 409);
      const judgeRow = isCoJudgeCard ? fresh.judges.find((j) => j.judgeId === card.judgeId) : null;
      if (isCoJudgeCard && !judgeRow) {
        throw new ExamPanelError("JUDGE_NOT_ON_EXAM", "That judge is no longer on this exam's jury.", 400);
      }
      if (judgeRow ? judgeRow.submittedAt : fresh.leadSubmittedAt) {
        throw new ExamPanelError("CARD_SUBMITTED", CARD_LOCKED_MESSAGE, 409);
      }

      const now = new Date();
      if (judgeRow) {
        await tx.examJudge.update({
          where: { id: judgeRow.id },
          // jsonb column — pass the score map object directly.
          data: { scoresJson: scores, subTotal: cardTotal, submittedAt: final ? now : null },
        });
      }
      await tx.exam.update({
        where: { id: exam.id },
        data: {
          ...(judgeRow
            ? {}
            : { scoresJson: scores as Prisma.InputJsonValue, leadSubmittedAt: final ? now : null }),
          ...(mayAdjust && deductions !== undefined ? { deductions } : {}),
          ...(mayAdjust && timeFaults !== undefined ? { timeFaults } : {}),
          ...(fresh.rubricSnapshotJson == null
            ? { rubricSnapshotJson: template.categoriesJson as Prisma.InputJsonValue }
            : {}),
          status: "in_progress",
        },
      });

      const locked = (await tx.exam.findUnique({
        where: { id: exam.id },
        include: { judges: { orderBy: { position: "asc" } } },
      }))!;
      const completion = final ? await completeIfPanelDone(tx, locked, session.userId) : null;
      let provisionalTotal = 0;
      if (!completion) {
        // Still waiting on at least one card: keep a provisional figure for the
        // lists, but no verdict until the whole panel is in.
        provisionalTotal = adjustedTotal(panelAggregate(rubric, locked), locked.deductions, locked.timeFaults);
        await tx.exam.update({
          where: { id: exam.id },
          data: { totalScore: provisionalTotal, passed: null },
        });
      }
      return { locked, completion, provisionalTotal };
    });
  } catch (e) {
    if (e instanceof ExamPanelError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }

  const { locked, completion } = outcome;
  const waitingFor = completion ? [] : pendingCards(locked);

  await audit({
    userId: session.userId,
    action: completion ? "exam.submit" : final ? "exam.card_submit" : "exam.draft",
    tableName: "exam",
    rowId: exam.id,
    before: { status: exam.status, totalScore: exam.totalScore },
    after: {
      status: completion ? "completed" : "in_progress",
      totalScore: completion ? completion.total : outcome.provisionalTotal,
      passed: completion ? completion.passed : null,
      card: card.judgeId ?? "lead",
      certificateId: completion?.certificateId ?? null,
    },
  });

  if (completion) {
    await afterExamCompleted(locked, completion, session.userId);
  }

  return NextResponse.json({
    ok: true,
    status: completion ? "completed" : "in_progress",
    totalScore: completion ? completion.total : outcome.provisionalTotal,
    max: completion ? completion.max : max,
    passed: completion ? completion.passed : null,
    certificateId: completion?.certificateId ?? null,
    completed: completion !== null,
    // Judges whose card is still open — the exam completes when this is empty.
    waitingFor,
  });
}

const resetSchema = z.object({ judgeId: z.string().min(1).optional() }).nullable();

// Reset a draft card: clears that card's marks. With no judgeId it is the lead
// examiner's card; a co-judge resets their own with { judgeId }.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.score")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const parsed = resetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const judgeId = parsed.data?.judgeId;

  const exam = await prisma.exam.findUnique({ where: { id: params.id }, include: { judges: true } });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, exam.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }
  const card = resolveCard(session, exam, judgeId);
  if ("error" in card) return card.error;
  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
  });
  const rubric = parseRubric(exam.rubricSnapshotJson ?? template?.categoriesJson ?? null);

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await lockExam(tx, exam.id);
      if (!fresh) throw new ExamPanelError("NOT_FOUND", "This exam no longer exists.", 404);
      if (fresh.status === "completed") throw new ExamPanelError("ALREADY_COMPLETED", COMPLETED_MESSAGE, 409);
      const judgeRow = card.judgeId ? fresh.judges.find((j) => j.judgeId === card.judgeId) : null;
      if (card.judgeId && !judgeRow) {
        throw new ExamPanelError("JUDGE_NOT_ON_EXAM", "That judge is no longer on this exam's jury.", 400);
      }
      if (judgeRow ? judgeRow.submittedAt : fresh.leadSubmittedAt) {
        throw new ExamPanelError("CARD_SUBMITTED", CARD_LOCKED_MESSAGE, 409);
      }
      if (judgeRow) {
        await tx.examJudge.update({
          where: { id: judgeRow.id },
          data: { scoresJson: Prisma.DbNull, subTotal: null },
        });
      } else {
        await tx.exam.update({ where: { id: exam.id }, data: { scoresJson: Prisma.DbNull } });
      }
      // Back to "scheduled" only when no card on the panel has marks left;
      // otherwise refresh the provisional figure without the cleared card.
      const after = (await tx.exam.findUnique({ where: { id: exam.id }, include: { judges: true } }))!;
      const anyMarks = after.scoresJson != null || after.judges.some((j) => j.scoresJson != null);
      await tx.exam.update({
        where: { id: exam.id },
        data: anyMarks
          ? {
              totalScore: adjustedTotal(panelAggregate(rubric, after), after.deductions, after.timeFaults),
              passed: null,
            }
          : { status: "scheduled", totalScore: null, passed: null },
      });
    });
  } catch (e) {
    if (e instanceof ExamPanelError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }

  await audit({
    userId: session.userId,
    action: "exam.reset_draft",
    tableName: "exam",
    rowId: exam.id,
    before: { status: exam.status, card: card.judgeId ?? "lead" },
  });

  return NextResponse.json({ ok: true });
}
