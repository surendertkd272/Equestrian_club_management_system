import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";

const schema = z.object({
  className: z.string().min(1),
  name: z.string().min(1).max(80),
  phase: z.enum(["dressage", "cross_country", "show_jumping", "jump_off"]).optional(),
});

// POST — add a round to a class. Round number auto-increments per
// (competition, class).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const comp = await prisma.competition.findUnique({ where: { id: params.id } });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const last = await prisma.competitionRound.findFirst({
    where: { competitionId: comp.id, className: parsed.data.className },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });
  const roundNumber = (last?.roundNumber ?? 0) + 1;

  const row = await prisma.competitionRound.create({
    data: {
      competitionId: comp.id,
      className: parsed.data.className,
      roundNumber,
      name: parsed.data.name,
      phase: parsed.data.phase ?? null,
    },
  });
  await audit({
    userId: session.userId,
    action: "competition.round_added",
    tableName: "competitionRound",
    rowId: row.id,
    after: { competitionId: comp.id, className: parsed.data.className, name: parsed.data.name },
  });
  return NextResponse.json({ ok: true, id: row.id, roundNumber });
}
