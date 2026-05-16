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
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const lesson = await prisma.lesson.findUnique({ where: { id: params.id } });
  if (!lesson) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && lesson.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateLessonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const updated = await prisma.lesson.update({
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
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const lesson = await prisma.lesson.findUnique({ where: { id: params.id } });
  if (!lesson) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && lesson.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  await prisma.lesson.delete({ where: { id: lesson.id } });
  await audit({ userId: session.userId, action: "delete", tableName: "lesson", rowId: lesson.id });
  return NextResponse.json({ ok: true });
}
