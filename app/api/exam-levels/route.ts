import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createExamLevelSchema } from "@/lib/schemas/exam-level";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// GET — list every active exam level grouped by discipline. Available to
// any authenticated user; centres need this to pick a level when adding a
// custom scoring rubric. Filtered to active=true unless ?showInactive=1.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const url = new URL(req.url);
  const showInactive = url.searchParams.get("showInactive") === "1";
  const discipline = url.searchParams.get("discipline");
  const levels = await prisma.examLevel.findMany({
    where: {
      ...(showInactive ? {} : { active: true }),
      ...(discipline ? { discipline } : {}),
    },
    orderBy: [{ discipline: "asc" }, { orderIndex: "asc" }],
  });
  return NextResponse.json({ levels });
}

// POST — HQ creates a new canonical level row. Centre staff can't add
// levels (would defeat the point of a single source of truth).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createExamLevelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const row = await prisma.examLevel.create({
      data: { ...parsed.data, updatedBy: session.userId },
    });
    await audit({
      userId: session.userId,
      action: "exam_level.create",
      tableName: "examLevel",
      rowId: row.id,
      after: { discipline: row.discipline, code: row.code, name: row.name },
    });
    return NextResponse.json({ id: row.id });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json(
        { error: "DUPLICATE", message: "A level with that discipline + order/code already exists." },
        { status: 409 },
      );
    }
    throw e;
  }
}
