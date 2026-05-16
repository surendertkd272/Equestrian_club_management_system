import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { rankGameResults, computeCombined } from "@/lib/gymkhana";

const recordSchema = z.object({
  gameId: z.string().min(1),
  entryId: z.string().min(1),
  time: z.coerce.number().min(0).max(7200).optional().nullable(),
  faults: z.coerce.number().int().min(0).max(50).default(0),
  points: z.coerce.number().min(0).max(1000).optional().nullable(),
  eliminated: z.boolean().default(false),
  notes: z.string().max(200).optional().nullable(),
});

// POST /api/competitions/[id]/gymkhana/results — upsert one (game, entry)
// result, then re-rank that game AND recompute the combined ranking for
// the affected class. The combined ranking lands on CompetitionEntry.score
// as a "lower is better" number (sum of per-game positions across all
// games in the class).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = recordSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  const game = await prisma.gymkhanaGame.findUnique({
    where: { id: d.gameId },
    select: { id: true, competitionId: true, className: true, scoringType: true, penaltyPerFault: true },
  });
  if (!game || game.competitionId !== params.id) {
    return NextResponse.json({ error: "GAME_NOT_FOUND" }, { status: 404 });
  }
  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { centreId: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // Save the per-(game, entry) row.
  await prisma.gymkhanaResult.upsert({
    where: { gameId_entryId: { gameId: d.gameId, entryId: d.entryId } },
    create: {
      gameId: d.gameId,
      entryId: d.entryId,
      time: d.time ?? null,
      faults: d.faults,
      points: d.points ?? null,
      eliminated: d.eliminated,
      notes: d.notes ?? null,
    },
    update: {
      time: d.time ?? null,
      faults: d.faults,
      points: d.points ?? null,
      eliminated: d.eliminated,
      notes: d.notes ?? null,
    },
  });

  // Re-rank every game in this className + recompute the combined.
  // Done on every save so the scoreboard stays live without a separate "publish" step.
  const gamesInClass = await prisma.gymkhanaGame.findMany({
    where: { competitionId: params.id, className: game.className },
    select: { id: true, scoringType: true, penaltyPerFault: true },
  });
  const allResults = await prisma.gymkhanaResult.findMany({
    where: { gameId: { in: gamesInClass.map((g) => g.id) } },
    select: { gameId: true, entryId: true, time: true, faults: true, points: true, eliminated: true },
  });
  const ranked = rankGameResults(
    gamesInClass.map((g) => ({ id: g.id, scoringType: g.scoringType as any, penaltyPerFault: g.penaltyPerFault })),
    allResults,
  );

  // Write back per-game position.
  for (const [gameId, rows] of ranked) {
    for (const r of rows) {
      await prisma.gymkhanaResult.updateMany({
        where: { gameId, entryId: r.entryId },
        data: { position: r.position },
      });
    }
  }

  // Combined → mirror onto CompetitionEntry.score so the scoreboard ranker
  // (lower is better for gymkhana — see lib/discipline.ts) picks it up.
  const combined = computeCombined(ranked);
  for (const c of combined) {
    await prisma.competitionEntry.updateMany({
      where: { id: c.entryId, competitionId: params.id },
      data: { score: c.combinedPosSum, time: c.totalEffectiveTime },
    });
  }

  await audit({
    userId: session.userId,
    action: "gymkhana.result_recorded",
    tableName: "gymkhanaResult",
    rowId: d.gameId,
    after: { entryId: d.entryId, eliminated: d.eliminated, time: d.time, faults: d.faults, points: d.points },
  });

  return NextResponse.json({ ok: true });
}
