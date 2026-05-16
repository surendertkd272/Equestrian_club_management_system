import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const createSchema = z.object({
  className: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  orderIndex: z.coerce.number().int().min(0).max(50).default(0),
  scoringType: z.enum(["time", "points"]).default("time"),
  penaltyPerFault: z.coerce.number().min(0).max(60).default(5),
  notes: z.string().max(300).optional().nullable(),
});

// GET /api/competitions/[id]/gymkhana/games — list games + per-game results.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const games = await prisma.gymkhanaGame.findMany({
    where: { competitionId: comp.id },
    orderBy: [{ className: "asc" }, { orderIndex: "asc" }],
    include: { results: true },
  });
  return NextResponse.json({ games });
}

// POST /api/competitions/[id]/gymkhana/games — add a new game for a class.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { centreId: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const game = await prisma.gymkhanaGame.create({
      data: {
        competitionId: params.id,
        ...parsed.data,
        notes: parsed.data.notes ?? null,
      },
    });
    await audit({
      userId: session.userId,
      action: "gymkhana.game_created",
      tableName: "gymkhanaGame",
      rowId: game.id,
      after: { name: game.name, className: game.className },
    });
    return NextResponse.json({ ok: true, id: game.id });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "DUPLICATE_NAME" }, { status: 409 });
    throw e;
  }
}
