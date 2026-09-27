import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { ExamPanelError } from "@/lib/exam-panel";
import { OPEN_EXAM_STATUSES, removableExamInclude, removalProblem, removalSnapshot } from "@/lib/exam-schedule";

const patchSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.date !== undefined || v.time !== undefined || v.notes !== undefined, {
    message: "Nothing to change.",
  });

const deleteSchema = z.object({ discardMarks: z.boolean().optional() }).nullable();

async function guard(id: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!can(session.role, "exam.schedule")) {
    return { ok: false as const, error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return { ok: false as const, error: readOnlyBlock };
  const sitting = await prisma.examSitting.findUnique({ where: { id }, select: { id: true, centreId: true } });
  if (!sitting) return { ok: false as const, error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const fence = await centreFence(session, sitting.centreId);
  if (fence) return { ok: false as const, error: NextResponse.json({ error: fence }, { status: 403 }) };
  return { ok: true as const, session, sitting };
}

function lockSitting(tx: Prisma.TransactionClient, id: string) {
  return tx.$queryRaw`SELECT id FROM "ExamSitting" WHERE id = ${id} FOR UPDATE`;
}

function panelErrorResponse(e: unknown) {
  if (e instanceof ExamPanelError) {
    return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  }
  throw e;
}

// PATCH — move the sitting (date and/or start time) or edit its notes. Every
// rider still waiting to be examined moves with it. Once any rider has a
// result the day is on record, so the date can no longer move.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if (!g.ok) return g.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: parsed.error.issues[0]?.message, details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  let moved = 0;
  let before: { date: Date; notes: string | null };
  try {
    ({ moved, before } = await prisma.$transaction(async (tx) => {
      await lockSitting(tx, g.sitting.id);
      const sitting = await tx.examSitting.findUnique({
        where: { id: g.sitting.id },
        include: { exams: { select: { status: true, reopenedAt: true } } },
      });
      if (!sitting) throw new ExamPanelError("NOT_FOUND", "This sitting no longer exists.", 404);
      const hasResults = sitting.exams.some((e) => e.status === "completed" || e.reopenedAt);
      if (d.date && hasResults) {
        throw new ExamPanelError(
          "SITTING_HAS_RESULTS",
          "Some riders in this sitting already have results, so its date can't move. Remove the riders still waiting and book them into a new sitting.",
          409,
        );
      }
      await tx.examSitting.update({
        where: { id: sitting.id },
        data: {
          ...(d.date ? { date: parseDateOnly(d.date) } : {}),
          ...(d.notes !== undefined ? { notes: d.notes } : {}),
        },
      });
      let count = 0;
      if (d.date || d.time) {
        const res = await tx.exam.updateMany({
          where: { sittingId: sitting.id, status: { in: OPEN_EXAM_STATUSES }, reopenedAt: null },
          data: {
            ...(d.date ? { date: parseDateOnly(d.date) } : {}),
            ...(d.time ? { time: d.time } : {}),
          },
        });
        count = res.count;
      }
      return { moved: count, before: { date: sitting.date, notes: sitting.notes } };
    }));
  } catch (e) {
    return panelErrorResponse(e);
  }

  await audit({
    userId: g.session.userId,
    action: "exam.sitting_updated",
    tableName: "examSitting",
    rowId: g.sitting.id,
    before,
    after: { ...d, examsMoved: moved },
  });
  return NextResponse.json({ ok: true, examsMoved: moved });
}

// DELETE — cancel the sitting: every rider still waiting is taken off the
// schedule. Riders who already have a result stay on record, and so does the
// sitting that holds them.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if (!g.ok) return g.error;
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const discardMarks = parsed.data?.discardMarks === true;

  let result: { removed: ReturnType<typeof removalSnapshot>[]; kept: number; sittingRemoved: boolean };
  try {
    result = await prisma.$transaction(async (tx) => {
      await lockSitting(tx, g.sitting.id);
      const exams = await tx.exam.findMany({ where: { sittingId: g.sitting.id }, include: removableExamInclude });
      const removable = exams.filter((e) => !removalProblem(e, true));
      // Marks already saved on a rider still waiting: refuse the whole
      // cancellation unless the caller has confirmed they can go.
      if (!discardMarks) {
        const marked = removable.find((e) => removalProblem(e, false));
        if (marked) throw removalProblem(marked, false)!;
      }
      if (removable.length > 0) {
        await tx.exam.deleteMany({ where: { id: { in: removable.map((e) => e.id) } } });
      }
      const kept = exams.length - removable.length;
      if (kept === 0) await tx.examSitting.delete({ where: { id: g.sitting.id } });
      return { removed: removable.map(removalSnapshot), kept, sittingRemoved: kept === 0 };
    });
  } catch (e) {
    return panelErrorResponse(e);
  }

  await audit({
    userId: g.session.userId,
    action: "exam.sitting_cancelled",
    tableName: "examSitting",
    rowId: g.sitting.id,
    before: { removed: result.removed },
    after: { kept: result.kept, sittingRemoved: result.sittingRemoved },
  });
  return NextResponse.json({
    ok: true,
    removed: result.removed.length,
    kept: result.kept,
    sittingRemoved: result.sittingRemoved,
  });
}
