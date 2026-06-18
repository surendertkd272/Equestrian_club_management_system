import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";

const addSchema = z.object({ judgeId: z.string().min(1) });

// POST — add a co-judge to an exam. Position auto-assigned as max+1, so the
// lead examiner stays implicit at position 1 (no row needed for them).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    include: { judges: { orderBy: { position: "desc" }, take: 1 } },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && exam.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (exam.status === "completed") {
    return NextResponse.json({ error: "ALREADY_COMPLETED" }, { status: 409 });
  }
  if (exam.examinerId === parsed.data.judgeId) {
    return NextResponse.json({ error: "ALREADY_LEAD" }, { status: 409 });
  }

  const judge = await prisma.user.findUnique({
    where: { id: parsed.data.judgeId },
    select: { id: true, name: true, role: true, centreId: true, status: true },
  });
  if (!judge || judge.status !== "active") return NextResponse.json({ error: "INVALID_JUDGE" }, { status: 400 });
  // Co-judge has to share the tenant context unless SUPER_ADMIN is staffing
  // a cross-centre meet.
  if (judge.centreId && judge.centreId !== exam.centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "JUDGE_CROSS_CENTRE" }, { status: 400 });
  }

  try {
    const nextPos = (exam.judges[0]?.position ?? 1) + 1;
    const row = await prisma.examJudge.create({
      data: {
        examId: exam.id,
        judgeId: judge.id,
        judgeName: judge.name,
        position: nextPos,
      },
    });
    await audit({
      userId: session.userId,
      action: "exam.judge_added",
      tableName: "examJudge",
      rowId: row.id,
      after: { examId: exam.id, judgeId: judge.id, position: nextPos },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "DUPLICATE_JUDGE" }, { status: 409 });
    throw e;
  }
}
