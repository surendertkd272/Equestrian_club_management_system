// Monthly Skills catalog — create entries for the current month. The
// admin curates the list; coaches can also add a skill if they have
// progress.write. Soft-deletes (active=false) preserve historic marks.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { scopeCentre } from "@/lib/tenancy";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createSkillSchema } from "@/lib/schemas/monthly-skill";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "progress.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const centreId = scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = createSkillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Next orderIndex within the (centre, month) bucket.
  const existing = await prisma.monthlySkillCatalog.findMany({
    where: { centreId, yearMonth: parsed.data.yearMonth },
    select: { orderIndex: true },
  });
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.orderIndex)) + 1 : 0;

  try {
    const row = await prisma.monthlySkillCatalog.create({
      data: {
        centreId,
        yearMonth: parsed.data.yearMonth,
        skillLabel: parsed.data.skillLabel,
        orderIndex: nextOrder,
      },
    });
    await audit({
      userId: session.userId,
      action: "monthly_skill.create",
      tableName: "monthlySkillCatalog",
      rowId: row.id,
      after: { yearMonth: row.yearMonth, skillLabel: row.skillLabel },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: any) {
    if (e.code === "P2002") {
      return NextResponse.json({ error: "DUPLICATE_SKILL" }, { status: 409 });
    }
    throw e;
  }
}
