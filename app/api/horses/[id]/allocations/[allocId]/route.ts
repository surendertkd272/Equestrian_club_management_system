import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; allocId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const alloc = await prisma.horseAllocation.findUnique({
    where: { id: params.allocId },
    include: { horse: { select: { centreId: true } } },
  });
  if (!alloc || alloc.horseId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence40 = await centreFence(session, alloc.horse.centreId);
  if (fence40) {
    return NextResponse.json({ error: fence40 }, { status: 403 });
  }

  await prisma.horseAllocation.delete({ where: { id: alloc.id } });
  await audit({
    userId: session.userId,
    action: "delete",
    tableName: "horseAllocation",
    rowId: alloc.id,
    before: alloc,
  });
  return NextResponse.json({ ok: true });
}
