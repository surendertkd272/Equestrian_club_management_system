import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

// DELETE — remove a co-judge from an exam. The lead examiner is never on
// this table (they're implicit at position 1) so this only ever removes a
// position-≥2 row.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; judgeRowId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const row = await prisma.examJudge.findUnique({
    where: { id: params.judgeRowId },
    include: { exam: { select: { id: true, centreId: true, status: true } } },
  });
  if (!row || row.examId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (session.role !== "SUPER_ADMIN" && row.exam.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (row.exam.status === "completed") {
    return NextResponse.json({ error: "ALREADY_COMPLETED" }, { status: 409 });
  }

  await prisma.examJudge.delete({ where: { id: row.id } });
  await audit({
    userId: session.userId,
    action: "exam.judge_removed",
    tableName: "examJudge",
    rowId: row.id,
    before: { examId: row.examId, judgeId: row.judgeId },
  });
  return NextResponse.json({ ok: true });
}
