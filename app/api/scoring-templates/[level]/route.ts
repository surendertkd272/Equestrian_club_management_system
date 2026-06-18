import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { updateScoringTemplateSchema } from "@/lib/schemas/exam";
import { audit } from "@/lib/audit";

export async function PUT(req: NextRequest, { params }: { params: { level: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.template_edit")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateScoringTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "centreId required" }, { status: 400 });

  const levelKey = String(params.level);
  const existing = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId, levelKey } },
  });

  const data = {
    centreId,
    levelKey,
    levelName: parsed.data.levelName,
    passThreshold: parsed.data.passThreshold,
    // jsonb column — pass the array directly (post-migration in 81f142a).
    categoriesJson: parsed.data.categories,
    updatedBy: session.userId,
  };

  const tpl = existing
    ? await prisma.scoringTemplate.update({ where: { id: existing.id }, data })
    : await prisma.scoringTemplate.create({ data });

  await audit({
    userId: session.userId,
    action: existing ? "update" : "create",
    tableName: "scoringTemplate",
    rowId: tpl.id,
    after: { levelKey, levelName: tpl.levelName, passThreshold: tpl.passThreshold },
  });

  return NextResponse.json({ ok: true, id: tpl.id });
}
