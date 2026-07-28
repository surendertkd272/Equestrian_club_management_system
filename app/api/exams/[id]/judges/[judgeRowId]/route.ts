import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
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

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const row = await prisma.examJudge.findUnique({
    where: { id: params.judgeRowId },
    include: { exam: { select: { id: true, centreId: true, status: true } } },
  });
  if (!row || row.examId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence42 = await centreFence(session, row.exam.centreId);
  if (fence42) {
    return NextResponse.json({ error: fence42 }, { status: 403 });
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
