import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { resolveCentreTz } from "@/lib/centre-tz";
import { AllocConflict } from "@/lib/allocation-guard";
import { assertHorseCanWork, assertHorseFree, lockHorse } from "@/lib/horse-availability";
import { slotWindow } from "@/lib/exam-running-order";
import { OPEN_EXAM_STATUSES } from "@/lib/exam-schedule";

// PUT — book the horse this rider rides in their exam slot (or clear it).
//
// Exams didn't record the horse at all, so nobody could see a horse's exam
// workload, and a horse under a drug-withdrawal hold could be ridden in an
// exam. The booking is an ordinary HorseAllocation (purpose "exam") held for
// the rider's slot, under the same rules as a lesson. It needs the sitting's
// running order: a horse can only be free at a time.
const schema = z.object({ horseId: z.string().min(1).nullable() });

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule") && !can(session.role, "horse.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    select: {
      id: true, centreId: true, riderId: true, date: true, time: true, status: true,
      sitting: { select: { slotMinutes: true } },
      horseAllocation: { select: { id: true, horseId: true } },
    },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, exam.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });

  const { horseId } = parsed.data;
  if (horseId === null) {
    if (exam.horseAllocation) await prisma.horseAllocation.delete({ where: { id: exam.horseAllocation.id } });
    await audit({ userId: session.userId, action: "exam.horse_cleared", tableName: "exam", rowId: exam.id, before: { horseId: exam.horseAllocation?.horseId ?? null } });
    return NextResponse.json({ ok: true, horseId: null });
  }
  if (!OPEN_EXAM_STATUSES.includes(exam.status)) {
    return NextResponse.json({ error: "NOT_OPEN", message: "Horses are booked for riders still to ride." }, { status: 409 });
  }
  if (!exam.sitting?.slotMinutes) {
    return NextResponse.json(
      { error: "NO_RUNNING_ORDER", message: "Set the sitting's running order first — the horse is booked for the rider's time slot." },
      { status: 409 },
    );
  }
  const horse = await prisma.horse.findUnique({ where: { id: horseId }, select: { id: true, name: true, status: true, centreId: true } });
  if (!horse || horse.centreId !== exam.centreId) return NextResponse.json({ error: "HORSE_NOT_FOUND" }, { status: 404 });

  const tz = await resolveCentreTz(exam.centreId);
  const { startAt, endAt } = slotWindow(exam.date, exam.time, exam.sitting.slotMinutes, tz);
  try {
    await prisma.$transaction(async (tx) => {
      await lockHorse(tx, horse.id);
      await assertHorseCanWork(tx, horse);
      await assertHorseFree(tx, horse, startAt, endAt, tz, exam.horseAllocation?.id);
      if (exam.horseAllocation) {
        await tx.horseAllocation.update({
          where: { id: exam.horseAllocation.id },
          data: { horseId: horse.id, startAt, endAt, riderId: exam.riderId },
        });
      } else {
        await tx.horseAllocation.create({
          data: { horseId: horse.id, riderId: exam.riderId, examId: exam.id, purpose: "exam", startAt, endAt, createdBy: session.userId },
        });
      }
    });
  } catch (e) {
    if (e instanceof AllocConflict) return NextResponse.json({ error: e.code, message: e.message }, { status: 409 });
    throw e;
  }
  await audit({
    userId: session.userId,
    action: "exam.horse_booked",
    tableName: "exam",
    rowId: exam.id,
    before: { horseId: exam.horseAllocation?.horseId ?? null },
    after: { horseId: horse.id, startAt, endAt },
  });
  return NextResponse.json({ ok: true, horseId: horse.id });
}
