import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { updateExamLevelSchema } from "@/lib/schemas/exam-level";
import { audit } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateExamLevelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.examLevel.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  try {
    const updated = await prisma.examLevel.update({
      where: { id: params.id },
      data: { ...parsed.data, updatedBy: session.userId },
    });
    await audit({
      userId: session.userId,
      action: "exam_level.update",
      tableName: "examLevel",
      rowId: updated.id,
      before: { code: before.code, orderIndex: before.orderIndex, name: before.name, active: before.active },
      after: { code: updated.code, orderIndex: updated.orderIndex, name: updated.name, active: updated.active },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "DUPLICATE" }, { status: 409 });
    }
    throw e;
  }
}

// Soft delete: mark inactive rather than DROP so historical exams that
// pointed at this level keep their reference. Hard delete only if nothing
// references it.
//
// Resolves #21 (hard-delete) + #24 (restore) for this resource. Pattern to
// replicate for other catalog tables (equipment, training-courses, etc.):
//   • DELETE → hard-delete when zero references, else flip active=false.
//   • PATCH active=true → restore.
// When auditing, the action string distinguishes hard vs soft (`.delete`
// vs `.archive`). New routes that do `{ active: false }` masquerading as
// delete should follow the same naming so the audit timeline stays
// searchable.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const row = await prisma.examLevel.findUnique({
    where: { id: params.id },
    include: { templates: { select: { id: true } } },
  });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (row.templates.length === 0) {
    await prisma.examLevel.delete({ where: { id: row.id } });
    await audit({ userId: session.userId, action: "exam_level.delete", tableName: "examLevel", rowId: row.id });
    return NextResponse.json({ ok: true, deleted: "hard" });
  }
  await prisma.examLevel.update({ where: { id: row.id }, data: { active: false } });
  await audit({ userId: session.userId, action: "exam_level.archive", tableName: "examLevel", rowId: row.id });
  return NextResponse.json({ ok: true, deleted: "soft" });
}
