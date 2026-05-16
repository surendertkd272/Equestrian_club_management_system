import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// DELETE /api/competitions/[id]/officials/[officialId] — remove an
// appointment. The (competition, user, role) row goes away; the user is
// untouched and can be re-appointed later.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; officialId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const row = await prisma.competitionOfficial.findUnique({
    where: { id: params.officialId },
    include: { competition: { select: { centreId: true } } },
  });
  if (!row || row.competitionId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (session.role !== "SUPER_ADMIN" && row.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await prisma.competitionOfficial.delete({ where: { id: row.id } });
  await audit({
    userId: session.userId,
    action: "competition.official_removed",
    tableName: "competitionOfficial",
    rowId: row.id,
    before: { userId: row.userId, role: row.role },
  });
  return NextResponse.json({ ok: true });
}
