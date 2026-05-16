import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; allocId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const alloc = await prisma.horseAllocation.findUnique({
    where: { id: params.allocId },
    include: { horse: { select: { centreId: true } } },
  });
  if (!alloc || alloc.horseId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && alloc.horse.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
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
