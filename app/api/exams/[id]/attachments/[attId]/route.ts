import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; attId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const row = await prisma.examAttachment.findUnique({
    where: { id: params.attId },
    include: { exam: { select: { centreId: true, examinerId: true } } },
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
  // Uploader or a manager can remove. Other examiners can't tamper.
  const canRemove =
    ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH"].includes(session.role) ||
    row.uploadedBy === session.userId ||
    row.exam.examinerId === session.userId;
  if (!canRemove) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  await prisma.examAttachment.delete({ where: { id: row.id } });
  await audit({
    userId: session.userId,
    action: "exam.attachment_removed",
    tableName: "examAttachment",
    rowId: row.id,
  });
  return NextResponse.json({ ok: true });
}
