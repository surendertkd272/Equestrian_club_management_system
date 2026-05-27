import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { updateSkillSchema, canManageCatalog } from "@/lib/schemas/catalog";

async function load(id: string, session: { role: string; centreId: string | null }) {
  const row = await prisma.skill.findUnique({ where: { id }, include: { level: { select: { centreId: true } } } });
  if (!row) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && row.level.centreId !== session.centreId) {
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
  const parsed = updateSkillSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });

  await prisma.skill.update({
    where: { id: row!.id },
    data: {
      ...(parsed.data.discipline !== undefined ? { discipline: parsed.data.discipline } : {}),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    },
  });
  await audit({ userId: session.userId, action: "skill.update", tableName: "skill", rowId: row!.id });
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

  // Block if riders have progress recorded against this skill (keep history).
  const inUse = await prisma.riderSkillStatus.count({ where: { skillId: row!.id } });
  if (inUse > 0) return NextResponse.json({ error: "SKILL_IN_USE", riders: inUse }, { status: 409 });

  await prisma.skill.delete({ where: { id: row!.id } });
  await audit({ userId: session.userId, action: "skill.delete", tableName: "skill", rowId: row!.id });
  return NextResponse.json({ ok: true });
}
