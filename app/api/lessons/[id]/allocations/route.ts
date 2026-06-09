import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { allocateLessonSchema } from "@/lib/schemas/lesson";
import { DEFAULT_WORKLOAD_CAP_MIN } from "@/lib/schemas/horse";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { AllocConflict } from "@/lib/allocation-guard";

// POST /api/lessons/[id]/allocations — replace this lesson's rider→horse
// pairings in one go. We delete + insert in a transaction so the table
// reflects exactly the body the caller sent (no orphans from old plans).
// Horse double-booking within the same lesson window is rejected.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "lesson.write")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const lesson = await prisma.lesson.findUnique({ where: { id: params.id } });
  if (!lesson) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && lesson.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = allocateLessonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const { pairings } = parsed.data;

  // Same horse twice in one lesson is almost certainly a paste error.
  const seenHorse = new Set<string>();
  for (const p of pairings) {
    if (seenHorse.has(p.horseId)) {
      return NextResponse.json(
        { error: "DUPLICATE_HORSE", message: `Horse ${p.horseId} appears more than once.` },
        { status: 409 },
      );
    }
    seenHorse.add(p.horseId);
  }
  const seenRider = new Set<string>();
  for (const p of pairings) {
    if (seenRider.has(p.riderId)) {
      return NextResponse.json(
        { error: "DUPLICATE_RIDER", message: `Rider ${p.riderId} appears more than once.` },
        { status: 409 },
      );
    }
    seenRider.add(p.riderId);
  }

  // Verify every horse + rider is in this centre to prevent cross-centre
  // bleed (especially for SUPER_ADMINs creating lessons).
  const horseIds = pairings.map((p) => p.horseId);
  const riderIds = pairings.map((p) => p.riderId);
  const [horses, riders] = await Promise.all([
    prisma.horse.findMany({ where: { id: { in: horseIds }, centreId: lesson.centreId }, select: { id: true, name: true, status: true } }),
    prisma.rider.findMany({ where: { id: { in: riderIds }, centreId: lesson.centreId }, select: { id: true } }),
  ]);
  if (horses.length !== horseIds.length) {
    return NextResponse.json({ error: "HORSE_NOT_IN_CENTRE" }, { status: 400 });
  }
  if (riders.length !== riderIds.length) {
    return NextResponse.json({ error: "RIDER_NOT_IN_CENTRE" }, { status: 400 });
  }

  // Rest/medical hold (C3): the lesson path previously never checked horse
  // status, so a resting/retired horse could be worked via a lesson.
  const unavailable = horses.filter((h) => h.status !== "active");
  if (unavailable.length > 0) {
    return NextResponse.json(
      { error: "HORSE_NOT_AVAILABLE", message: `Not available: ${unavailable.map((h) => `${h.name} (${h.status})`).join(", ")}.` },
      { status: 409 },
    );
  }
  // Drug-withdrawal hold (C4): block any horse still inside an administered
  // medicine's withdrawal period — checked directly, not via the editable status.
  const withdrawalRows = await prisma.medicineUsage.findMany({
    where: { horseId: { in: horseIds }, withdrawalUntil: { gt: new Date() } },
    select: { horseId: true },
  });
  if (withdrawalRows.length > 0) {
    const blocked = new Set(withdrawalRows.map((r) => r.horseId));
    const names = horses.filter((h) => blocked.has(h.id)).map((h) => h.name);
    return NextResponse.json(
      { error: "WITHDRAWAL_ACTIVE", message: `Under drug withdrawal: ${names.join(", ")}.` },
      { status: 409 },
    );
  }

  // Atomic check-and-replace (C2/C3): lock all involved horse rows FOR UPDATE
  // (ordered, to avoid deadlocks), re-check the cross-lesson clash, recompute
  // the per-horse daily cap AFTER clearing this lesson's prior rows, then
  // insert — all in one transaction so concurrent saves can't double-book or
  // bust the cap. Previously the clash read was outside the (array) tx and the
  // cap was never enforced here at all.
  const lessonMin = (lesson.endAt.getTime() - lesson.date.getTime()) / 60000;
  const dayStart = new Date(lesson.date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(lesson.date); dayEnd.setHours(23, 59, 59, 999);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Horse" WHERE id IN (${Prisma.join(horseIds)}) ORDER BY id FOR UPDATE`;

      const clashes = await tx.horseAllocation.findMany({
        where: {
          horseId: { in: horseIds },
          lessonId: { not: lesson.id },
          startAt: { lt: lesson.endAt },
          endAt: { gt: lesson.date },
        },
        select: { horseId: true },
      });
      if (clashes.length > 0) {
        const names = horses.filter((h) => clashes.some((c) => c.horseId === h.id)).map((h) => h.name);
        throw new AllocConflict("HORSE_DOUBLE_BOOKED", `Already booked in an overlapping window: ${names.join(", ")}.`);
      }

      // Clear this lesson's prior pairings first so the cap recompute below
      // doesn't double-count them.
      await tx.horseAllocation.deleteMany({ where: { lessonId: lesson.id } });

      const others = await tx.horseAllocation.findMany({
        where: { horseId: { in: horseIds }, startAt: { gte: dayStart, lte: dayEnd } },
        select: { horseId: true, startAt: true, endAt: true },
      });
      const usedByHorse = new Map<string, number>();
      for (const a of others) {
        usedByHorse.set(a.horseId, (usedByHorse.get(a.horseId) ?? 0) + (a.endAt.getTime() - a.startAt.getTime()) / 60000);
      }
      for (const h of horses) {
        const total = (usedByHorse.get(h.id) ?? 0) + lessonMin;
        if (total > DEFAULT_WORKLOAD_CAP_MIN) {
          throw new AllocConflict(
            "WORKLOAD_EXCEEDED",
            `${h.name} would exceed the daily ${DEFAULT_WORKLOAD_CAP_MIN}-minute work cap (${Math.round(total)} min).`,
          );
        }
      }

      await tx.horseAllocation.createMany({
        data: pairings.map((p) => ({
          lessonId: lesson.id,
          horseId: p.horseId,
          riderId: p.riderId,
          purpose: "lesson",
          startAt: lesson.date,
          endAt: lesson.endAt,
          notes: p.notes ?? null,
          createdBy: session.userId,
        })),
      });
    });
  } catch (e) {
    if (e instanceof AllocConflict) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: 409 });
    }
    throw e;
  }

  await audit({
    userId: session.userId,
    action: "lesson.allocations_set",
    tableName: "lesson",
    rowId: lesson.id,
    after: { count: pairings.length },
  });

  return NextResponse.json({ ok: true, count: pairings.length });
}
