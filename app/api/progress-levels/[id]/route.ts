import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { updateProgressLevelSchema, canManageCatalog } from "@/lib/schemas/catalog";

async function load(id: string, session: { role: string; centreId: string | null }) {
  const row = await prisma.progressLevel.findUnique({ where: { id } });
  if (!row) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && row.centreId !== session.centreId) {
    return { error: NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 }) };
  }
  return { row };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageCatalog(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { row, error } = await load(params.id, session);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = updateProgressLevelSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });

  await prisma.progressLevel.update({
    where: { id: row!.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.order !== undefined ? { order: parsed.data.order } : {}),
    },
  });
  await audit({ userId: session.userId, action: "progress_level.update", tableName: "progressLevel", rowId: row!.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageCatalog(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { row, error } = await load(params.id, session);
  if (error) return error;

  // Block delete if the level still has skills or assessments — the admin
  // must clear those first (avoids orphaning rider progress / exam history).
  const [skillCount, assessmentCount] = await Promise.all([
    prisma.skill.count({ where: { levelId: row!.id } }),
    prisma.assessment.count({ where: { levelId: row!.id } }),
  ]);
  if (skillCount > 0 || assessmentCount > 0) {
    return NextResponse.json({ error: "LEVEL_IN_USE", skillCount, assessmentCount }, { status: 409 });
  }

  await prisma.progressLevel.delete({ where: { id: row!.id } });
  await audit({ userId: session.userId, action: "progress_level.delete", tableName: "progressLevel", rowId: row!.id });
  return NextResponse.json({ ok: true });
}
