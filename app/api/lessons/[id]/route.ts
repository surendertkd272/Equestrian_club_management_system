import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateLessonSchema } from "@/lib/schemas/lesson";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const lesson = await prisma.lesson.findUnique({
    where: { id: params.id },
    include: {
      batch: { select: { id: true, name: true, level: true } },
      allocations: {
        include: {
          rider: { select: { id: true, firstName: true, lastName: true } },
          horse: { select: { id: true, name: true, stableNo: true } },
        },
      },
    },
  });
  if (!lesson) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && lesson.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return NextResponse.json({ lesson });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
  const parsed = updateLessonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Cross-field date sanity. The create schema refines endAt > date, but this
  // PATCH applies each field independently, so a one-sided edit (move endAt
  // before the stored date, or date past the stored endAt) would invert the
  // window. Merge incoming over stored and re-check — same fix as events (#133).
  const effDate = d.date !== undefined ? new Date(d.date) : lesson.date;
  const effEnd = d.endAt !== undefined ? new Date(d.endAt) : lesson.endAt;
  if (effEnd && !(effEnd > effDate)) {
    return NextResponse.json({ error: "INVALID_DATE_RANGE", message: "endAt must be after the lesson start" }, { status: 400 });
  }

  // Cancelling a lesson must release its horses: otherwise the lesson's
  // HorseAllocation rows linger and keep blocking those horses (overlap) and
  // consuming their daily cap — ghost bookings. Drop them in the same tx.
  const willCancel = d.status === "cancelled" && lesson.status !== "cancelled";
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.lesson.update({
      where: { id: lesson.id },
      data: {
        ...(d.date !== undefined ? { date: new Date(d.date) } : {}),
        ...(d.endAt !== undefined ? { endAt: new Date(d.endAt) } : {}),
        ...(d.coachId !== undefined ? { coachId: d.coachId } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
        ...(d.rescheduledToId !== undefined ? { rescheduledToId: d.rescheduledToId } : {}),
      },
    });
    if (willCancel) {
      await tx.horseAllocation.deleteMany({ where: { lessonId: lesson.id } });
    }
    return u;
  });
  await audit({
    userId: session.userId,
    action: "update",
    tableName: "lesson",
    rowId: updated.id,
    before: { status: lesson.status, date: lesson.date },
    after: { status: updated.status, date: updated.date },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // lesson.write — granted to COACH + HEAD_COACH + CENTRE_MANAGER + ADMIN
  // + SUPER_ADMIN. Coaches need this to clean up wrongly-scheduled
  // sessions for their own batches. Cross-centre is still blocked below.
  if (!can(session.role, "lesson.write")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const lesson = await prisma.lesson.findUnique({ where: { id: params.id } });
  if (!lesson) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // isHQ matches the canonical pattern used elsewhere — ADMIN deserves the
  // same cross-centre bypass that SUPER_ADMIN has.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && lesson.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  // Delete the lesson's HorseAllocation rows too. The FK is onDelete: SetNull,
  // so without this the rows would survive with lessonId=null and keep blocking
  // their horses (overlap) + consuming the daily cap — orphaned ghost bookings.
  await prisma.$transaction([
    prisma.horseAllocation.deleteMany({ where: { lessonId: lesson.id } }),
    prisma.lesson.delete({ where: { id: lesson.id } }),
  ]);
  await audit({ userId: session.userId, action: "delete", tableName: "lesson", rowId: lesson.id });
  return NextResponse.json({ ok: true });
}
