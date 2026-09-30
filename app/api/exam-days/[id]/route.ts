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
import { shiftTime, syncExamHorsesTx, toMinutes } from "@/lib/exam-running-order";
import { resolveCentreTz } from "@/lib/centre-tz";

// Manage a whole exam day: rename it, move it, or cancel it. Mirrors the
// per-sitting controls in /api/exam-sittings/[id], applied to every sitting
// on the day at once.
const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change." });
const deleteSchema = z.object({ discardMarks: z.boolean().optional() }).nullable();

async function guard(id: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!can(session.role, "exam.schedule")) {
    return { ok: false as const, error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return { ok: false as const, error: readOnlyBlock };
  const day = await prisma.examDay.findUnique({ where: { id }, select: { id: true, centreId: true } });
  if (!day) return { ok: false as const, error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const fence = await centreFence(session, day.centreId);
  if (fence) return { ok: false as const, error: NextResponse.json({ error: fence }, { status: 403 }) };
  return { ok: true as const, session, day };
}

const lockDay = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT id FROM "ExamDay" WHERE id = ${id} FOR UPDATE`;

function panelErrorResponse(e: unknown) {
  if (e instanceof ExamPanelError) {
    return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  }
  throw e;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if (!g.ok) return g.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const d = parsed.data;
  let moved = 0;
  let released: { examId: string; horse: string; reason: string }[] = [];
  let before: unknown;
  try {
    ({ moved, before } = await prisma.$transaction(async (tx) => {
      await lockDay(tx, g.day.id);
      const day = await tx.examDay.findUnique({
        where: { id: g.day.id },
        include: { sittings: { select: { id: true, exams: { select: { status: true, reopenedAt: true } } } } },
      });
      if (!day) throw new ExamPanelError("NOT_FOUND", "This exam day no longer exists.", 404);
      const hasResults = day.sittings.some((s) => s.exams.some((e) => e.status === "completed" || e.reopenedAt));
      if (d.date && hasResults) {
        throw new ExamPanelError(
          "DAY_HAS_RESULTS",
          "Some riders on this day already have results, so the date can't move. Remove the riders still waiting and book them onto a new day.",
          409,
        );
      }
      const date = d.date ? parseDateOnly(d.date) : undefined;
      await tx.examDay.update({
        where: { id: day.id },
        data: {
          ...(d.name ? { name: d.name } : {}),
          ...(date ? { date } : {}),
          ...(d.time ? { time: d.time } : {}),
          ...(d.notes !== undefined ? { notes: d.notes } : {}),
        },
      });
      let count = 0;
      if (date || d.time) {
        const ids = day.sittings.map((s) => s.id);
        if (date) await tx.examSitting.updateMany({ where: { id: { in: ids } }, data: { date } });
        const open = await tx.exam.findMany({
          where: { sittingId: { in: ids }, status: { in: OPEN_EXAM_STATUSES }, reopenedAt: null },
          select: { id: true, time: true, sitting: { select: { slotMinutes: true } } },
        });
        // Sittings with a running order keep their riders' spacing: every slot
        // moves by the change in the day's start. The rest move to the new start.
        const delta = d.time ? toMinutes(d.time) - toMinutes(day.time) : 0;
        const ordered = open.filter((e) => e.sitting?.slotMinutes);
        const plain = open.filter((e) => !e.sitting?.slotMinutes);
        for (const e of ordered) {
          await tx.exam.update({
            where: { id: e.id },
            data: { ...(date ? { date } : {}), ...(delta ? { time: shiftTime(e.time, delta) } : {}) },
          });
        }
        if (plain.length) {
          await tx.exam.updateMany({
            where: { id: { in: plain.map((e) => e.id) } },
            data: { ...(date ? { date } : {}), ...(d.time ? { time: d.time } : {}) },
          });
        }
        count = open.length;
        released = await syncExamHorsesTx(tx, open.map((e) => e.id), await resolveCentreTz(g.day.centreId));
      }
      return { moved: count, before: { name: day.name, date: day.date, time: day.time, notes: day.notes } };
    }, { timeout: 30_000 }));
  } catch (e) {
    return panelErrorResponse(e);
  }
  await audit({
    userId: g.session.userId,
    action: "exam.day_updated",
    tableName: "examDay",
    rowId: g.day.id,
    before,
    after: { ...d, examsMoved: moved, horsesReleased: released.length },
  });
  return NextResponse.json({ ok: true, examsMoved: moved, horsesReleased: released });
}

// Cancel the day: every rider still waiting comes off the schedule. Riders
// with a result stay on record, with their sittings and the day.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if (!g.ok) return g.error;
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const discardMarks = parsed.data?.discardMarks === true;

  let result: { removed: ReturnType<typeof removalSnapshot>[]; kept: number; dayRemoved: boolean };
  try {
    result = await prisma.$transaction(async (tx) => {
      await lockDay(tx, g.day.id);
      const sittings = await tx.examSitting.findMany({ where: { examDayId: g.day.id }, select: { id: true } });
      const exams = await tx.exam.findMany({
        where: { sittingId: { in: sittings.map((s) => s.id) } },
        include: removableExamInclude,
      });
      const removable = exams.filter((e) => !removalProblem(e, true));
      if (!discardMarks) {
        const marked = removable.find((e) => removalProblem(e, false));
        if (marked) throw removalProblem(marked, false)!;
      }
      if (removable.length > 0) await tx.exam.deleteMany({ where: { id: { in: removable.map((e) => e.id) } } });
      // Drop sittings left empty; keep any that still hold a result.
      for (const s of sittings) {
        if ((await tx.exam.count({ where: { sittingId: s.id } })) === 0) {
          await tx.examSitting.delete({ where: { id: s.id } });
        }
      }
      const kept = exams.length - removable.length;
      if (kept === 0) await tx.examDay.delete({ where: { id: g.day.id } });
      return { removed: removable.map(removalSnapshot), kept, dayRemoved: kept === 0 };
    });
  } catch (e) {
    return panelErrorResponse(e);
  }
  await audit({
    userId: g.session.userId,
    action: "exam.day_cancelled",
    tableName: "examDay",
    rowId: g.day.id,
    before: { removed: result.removed },
    after: { kept: result.kept, dayRemoved: result.dayRemoved },
  });
  return NextResponse.json({ ok: true, removed: result.removed.length, kept: result.kept, dayRemoved: result.dayRemoved });
}
