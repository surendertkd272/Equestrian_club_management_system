import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; roundId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const round = await prisma.competitionRound.findUnique({
    where: { id: params.roundId },
    include: { competition: { select: { centreId: true } } },
  });
  if (!round || round.competitionId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (session.role !== "SUPER_ADMIN" && round.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  await prisma.competitionRound.delete({ where: { id: round.id } });
  await audit({
    userId: session.userId,
    action: "competition.round_removed",
    tableName: "competitionRound",
    rowId: round.id,
  });
  return NextResponse.json({ ok: true });
}
