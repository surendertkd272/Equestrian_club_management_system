import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { allocateLessonSchema } from "@/lib/schemas/lesson";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// POST /api/lessons/[id]/allocations — replace this lesson's rider→horse
// pairings in one go. We delete + insert in a transaction so the table
// reflects exactly the body the caller sent (no orphans from old plans).
// Horse double-booking within the same lesson window is rejected.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const lesson = await prisma.lesson.findUnique({ where: { id: params.id } });
  if (!lesson) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && lesson.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
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
    prisma.horse.findMany({ where: { id: { in: horseIds }, centreId: lesson.centreId }, select: { id: true } }),
    prisma.rider.findMany({ where: { id: { in: riderIds }, centreId: lesson.centreId }, select: { id: true } }),
  ]);
  if (horses.length !== horseIds.length) {
    return NextResponse.json({ error: "HORSE_NOT_IN_CENTRE" }, { status: 400 });
  }
  if (riders.length !== riderIds.length) {
    return NextResponse.json({ error: "RIDER_NOT_IN_CENTRE" }, { status: 400 });
  }

  // Cross-lesson horse clash: any other allocation for one of these horses
  // that overlaps the lesson window is a conflict the operator must resolve.
  const clashes = await prisma.horseAllocation.findMany({
    where: {
      horseId: { in: horseIds },
      lessonId: { not: lesson.id },
      startAt: { lt: lesson.endAt },
      endAt: { gt: lesson.date },
    },
    select: { horseId: true, lessonId: true },
  });
  if (clashes.length > 0) {
    return NextResponse.json(
      { error: "HORSE_DOUBLE_BOOKED", details: clashes },
      { status: 409 },
    );
  }

  await prisma.$transaction([
    prisma.horseAllocation.deleteMany({ where: { lessonId: lesson.id } }),
    prisma.horseAllocation.createMany({
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
    }),
  ]);

  await audit({
    userId: session.userId,
    action: "lesson.allocations_set",
    tableName: "lesson",
    rowId: lesson.id,
    after: { count: pairings.length },
  });

  return NextResponse.json({ ok: true, count: pairings.length });
}
