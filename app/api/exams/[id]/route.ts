import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { ExamPanelError, lockExam } from "@/lib/exam-panel";
import { removableExamInclude, removalProblem, removalSnapshot } from "@/lib/exam-schedule";

const patchSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  })
  .refine((v) => v.date !== undefined || v.time !== undefined, { message: "Give a new date or time." });

const deleteSchema = z.object({ discardMarks: z.boolean().optional() }).nullable();

async function guard(id: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!can(session.role, "exam.schedule")) {
    return { ok: false as const, error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return { ok: false as const, error: readOnlyBlock };
  const exam = await prisma.exam.findUnique({ where: { id }, select: { id: true, centreId: true } });
  if (!exam) return { ok: false as const, error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const fence = await centreFence(session, exam.centreId);
  if (fence) return { ok: false as const, error: NextResponse.json({ error: fence }, { status: 403 }) };
  return { ok: true as const, session, exam };
}

function panelErrorResponse(e: unknown) {
  if (e instanceof ExamPanelError) {
    return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  }
  throw e;
}

// PATCH — move a single exam to a new date and/or time. Exams that belong to
// a sitting move with the sitting (/api/exam-sittings/[id]) so the sitting's
// riders never drift onto different days.
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

  let before: { date: Date; time: string };
  try {
    before = await prisma.$transaction(async (tx) => {
      const fresh = await lockExam(tx, g.exam.id);
      if (!fresh) throw new ExamPanelError("NOT_FOUND", "This exam no longer exists.", 404);
      if (fresh.status === "completed") {
        throw new ExamPanelError("ALREADY_COMPLETED", "A completed exam can't be rescheduled.", 409);
      }
      if (fresh.sittingId) {
        throw new ExamPanelError(
          "IN_SITTING",
          "This rider is booked in an exam sitting. Change the sitting's date, or remove the rider from it and book them into another.",
          409,
        );
      }
      await tx.exam.update({
        where: { id: fresh.id },
        data: {
          ...(d.date ? { date: parseDateOnly(d.date) } : {}),
          ...(d.time ? { time: d.time } : {}),
        },
      });
      return { date: fresh.date, time: fresh.time };
    });
  } catch (e) {
    return panelErrorResponse(e);
  }

  await audit({
    userId: g.session.userId,
    action: "exam.rescheduled",
    tableName: "exam",
    rowId: g.exam.id,
    before,
    after: d,
  });
  return NextResponse.json({ ok: true });
}

// DELETE — take an exam off the schedule (e.g. remove a rider from a
// sitting). Never deletes a result: see removalProblem().
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if (!g.ok) return g.error;
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const discardMarks = parsed.data?.discardMarks === true;

  let removed: ReturnType<typeof removalSnapshot>;
  let sittingRemoved: string | null = null;
  try {
    ({ removed, sittingRemoved } = await prisma.$transaction(async (tx) => {
      await lockExam(tx, g.exam.id);
      const fresh = await tx.exam.findUnique({ where: { id: g.exam.id }, include: removableExamInclude });
      if (!fresh) throw new ExamPanelError("NOT_FOUND", "This exam no longer exists.", 404);
      const problem = removalProblem(fresh, discardMarks);
      if (problem) throw problem;
      await tx.exam.delete({ where: { id: fresh.id } });
      // A sitting left with no riders is an empty shell on the schedule.
      let emptiedSitting: string | null = null;
      if (fresh.sittingId && (await tx.exam.count({ where: { sittingId: fresh.sittingId } })) === 0) {
        await tx.examSitting.delete({ where: { id: fresh.sittingId } });
        emptiedSitting = fresh.sittingId;
      }
      return { removed: removalSnapshot(fresh), sittingRemoved: emptiedSitting };
    }));
  } catch (e) {
    return panelErrorResponse(e);
  }

  await audit({
    userId: g.session.userId,
    action: "exam.removed",
    tableName: "exam",
    rowId: g.exam.id,
    before: removed,
    after: sittingRemoved ? { sittingRemoved } : undefined,
  });
  return NextResponse.json({ ok: true, sittingRemoved });
}
