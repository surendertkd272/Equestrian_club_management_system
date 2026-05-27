// Edit / soft-delete a Monthly Skill catalog row. Soft-delete preserves
// the historic MonthlySkillMark rows for past riders.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { updateSkillSchema } from "@/lib/schemas/monthly-skill";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "progress.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const row = await prisma.monthlySkillCatalog.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== row.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSkillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.monthlySkillCatalog.update({
    where: { id: row.id },
    data: {
      ...(parsed.data.skillLabel !== undefined ? { skillLabel: parsed.data.skillLabel } : {}),
      ...(parsed.data.orderIndex !== undefined ? { orderIndex: parsed.data.orderIndex } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    },
  });
  await audit({
    userId: session.userId,
    action: "monthly_skill.update",
    tableName: "monthlySkillCatalog",
    rowId: row.id,
    before: { skillLabel: row.skillLabel, active: row.active },
    after: { skillLabel: updated.skillLabel, active: updated.active },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "progress.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const row = await prisma.monthlySkillCatalog.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== row.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  await prisma.monthlySkillCatalog.update({
    where: { id: row.id },
    data: { active: false },
  });
  await audit({
    userId: session.userId,
    action: "monthly_skill.deactivate",
    tableName: "monthlySkillCatalog",
    rowId: row.id,
  });
  return NextResponse.json({ ok: true });
}
