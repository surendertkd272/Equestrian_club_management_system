import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createSkillSchema, canManageCatalog } from "@/lib/schemas/catalog";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageCatalog(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createSkillSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });

  // The skill's level must belong to the caller's centre (HQ may target any).
  const level = await prisma.progressLevel.findUnique({
    where: { id: parsed.data.levelId },
    select: { id: true, centreId: true },
  });
  if (!level) return NextResponse.json({ error: "LEVEL_NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && level.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const row = await prisma.skill.create({
    data: {
      levelId: parsed.data.levelId,
      discipline: parsed.data.discipline,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    },
  });
  await audit({ userId: session.userId, action: "skill.create", tableName: "skill", rowId: row.id, after: { levelId: row.levelId, name: row.name } });
  return NextResponse.json({ ok: true, id: row.id });
}
