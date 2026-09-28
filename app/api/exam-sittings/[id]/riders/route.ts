import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { BookingError, MAX_RIDERS_PER_SITTING, addExamsToSittingTx, checkBookings } from "@/lib/exam-booking";
import { assertDayRoom, assertNotPast, panelOf, sittingDefaults } from "@/lib/exam-late-riders";

// Add late riders to a sitting that's already booked — a family that
// registered after the day was planned, or a rider who turns up on the
// morning. Same booking rules as booking the sitting; they join its queue,
// with its jury panel seated on them.
const schema = z.object({
  riderIds: z.array(z.string().min(1)).min(1).max(MAX_RIDERS_PER_SITTING),
  allowSkipLevels: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const sitting = await prisma.examSitting.findUnique({
    where: { id: params.id },
    select: {
      id: true, centreId: true, level: true, date: true, examDayId: true, panelJudgeIds: true,
      examDay: { select: { time: true } },
      _count: { select: { exams: true } },
    },
  });
  if (!sitting) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, sitting.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });

  const riderIds = Array.from(new Set(parsed.data.riderIds));
  try {
    await assertNotPast(sitting.centreId, sitting.date);
    if (sitting._count.exams + riderIds.length > MAX_RIDERS_PER_SITTING) {
      throw new BookingError(
        "SITTING_FULL",
        `This sitting has ${sitting._count.exams} riders; the most for one sitting is ${MAX_RIDERS_PER_SITTING}.` +
          (sitting.examDayId ? " Add them from the exam day page instead — a new group opens for the overflow." : ""),
        400,
      );
    }
    if (sitting.examDayId) await assertDayRoom(prisma, sitting.examDayId, riderIds.length);
    const { ladder, priorFails, skipped } = await checkBookings(prisma, {
      centreId: sitting.centreId,
      entries: riderIds.map((riderId) => ({ riderId, level: sitting.level })),
      allowSkipLevels: parsed.data.allowSkipLevels,
    });
    const { rubric, time } = await sittingDefaults(prisma, sitting.id, sitting.level, ladder, sitting.examDay?.time ?? "09:00");
    const panel = await panelOf(prisma, sitting.panelJudgeIds);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExamSitting" WHERE id = ${sitting.id} FOR UPDATE`;
      await addExamsToSittingTx(tx, {
        sittingId: sitting.id,
        centreId: sitting.centreId,
        level: sitting.level,
        date: sitting.date,
        time,
        riderIds,
        rubric,
        priorFails,
        panel,
      });
      // The sitting has open riders again, so its "all marked" summary is due
      // again when they finish.
      await tx.examSitting.update({ where: { id: sitting.id }, data: { completedNotifiedAt: null } });
      if (sitting.examDayId) {
        await tx.examDay.update({ where: { id: sitting.examDayId }, data: { completedNotifiedAt: null } });
      }
    });

    await audit({
      userId: session.userId,
      action: "exam.sitting_riders_added",
      tableName: "examSitting",
      rowId: sitting.id,
      after: { riderIds, level: sitting.level, ...(skipped.length ? { skippedLevels: skipped } : {}) },
    });
    return NextResponse.json({ ok: true, added: riderIds.length });
  } catch (e) {
    if (e instanceof BookingError) {
      return NextResponse.json({ error: e.code, message: e.message, details: e.details }, { status: e.status });
    }
    throw e;
  }
}
