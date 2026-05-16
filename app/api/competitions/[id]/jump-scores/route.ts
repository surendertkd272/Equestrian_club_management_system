import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { recordJumpScoresSchema } from "@/lib/schemas/jump-score";
import { computeJumpFaults } from "@/lib/jumping-faults";
import { recomputeEventingCombined } from "@/lib/eventing-combined";

// POST /api/competitions/[id]/jump-scores — replace the per-fence
// scoresheet for one (round, entry). Delete + insert in a transaction
// so the row set matches the body exactly. The aggregate faults/time
// land on CompetitionRoundScore AND mirror onto CompetitionEntry so
// the existing scoreboard ranker keeps working.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = recordJumpScoresSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const round = await prisma.competitionRound.findUnique({
    where: { id: d.roundId },
    select: { id: true, competitionId: true, timeAllowedSec: true, timeLimitSec: true, className: true },
  });
  if (!round || round.competitionId !== params.id) {
    return NextResponse.json({ error: "ROUND_NOT_FOUND" }, { status: 404 });
  }
  const entry = await prisma.competitionEntry.findUnique({
    where: { id: d.entryId },
    select: { id: true, competitionId: true, className: true },
  });
  if (!entry || entry.competitionId !== params.id || entry.className !== round.className) {
    return NextResponse.json({ error: "ENTRY_ROUND_MISMATCH" }, { status: 400 });
  }

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { centreId: true, discipline: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // Time-limit elimination — over timeLimit = eliminated regardless of
  // fence faults. timeAllowed is the soft threshold for time penalties.
  const exceededLimit =
    typeof d.timeSec === "number" && round.timeLimitSec !== null && d.timeSec > round.timeLimitSec;
  const computed = exceededLimit
    ? { ok: false as const, eliminated: true as const, reason: "Time limit exceeded", firstEliminatedAtFence: "—" }
    : computeJumpFaults(d.efforts, d.timeSec ?? null, round.timeAllowedSec ?? null);

  const aggregateData = {
    faults: computed.ok ? computed.faults : null,
    time: d.timeSec ?? null,
    notes: computed.ok ? null : computed.reason,
  };

  await prisma.$transaction([
    prisma.jumpEffort.deleteMany({ where: { roundId: round.id, entryId: entry.id } }),
    prisma.jumpEffort.createMany({
      data: d.efforts.map((e) => ({
        roundId: round.id,
        entryId: entry.id,
        fenceNo: e.fenceNo,
        knockdown: e.knockdown,
        refusal: e.refusal,
        eliminated: e.eliminated,
        fall: e.fall,
        notes: e.notes ?? null,
      })),
    }),
    prisma.competitionRoundScore.upsert({
      where: { roundId_entryId: { roundId: round.id, entryId: entry.id } },
      create: { roundId: round.id, entryId: entry.id, ...aggregateData },
      update: aggregateData,
    }),
    prisma.competitionEntry.update({
      where: { id: entry.id },
      data: { faults: aggregateData.faults, time: aggregateData.time },
    }),
  ]);

  // If this round is part of an eventing comp, run the combined-rank
  // recompute so the entry's overall standing reflects this phase too.
  if (comp.discipline === "eventing") {
    await recomputeEventingCombined(entry.id);
  }

  await audit({
    userId: session.userId,
    action: "competition.jump_scored",
    tableName: "competitionRoundScore",
    rowId: round.id,
    after: {
      entryId: entry.id,
      eliminated: !computed.ok,
      faults: aggregateData.faults,
      time: aggregateData.time,
    },
  });

  return NextResponse.json({
    ok: true,
    eliminated: !computed.ok,
    faults: aggregateData.faults,
    reason: computed.ok ? null : computed.reason,
    timeSec: aggregateData.time,
  });
}

// GET /api/competitions/[id]/jump-scores?roundId=&entryId= — fetch the
// existing efforts so the scoresheet UI can hydrate on open.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const url = new URL(req.url);
  const roundId = url.searchParams.get("roundId");
  const entryId = url.searchParams.get("entryId");
  if (!roundId || !entryId) return NextResponse.json({ error: "BAD_QUERY" }, { status: 400 });

  const round = await prisma.competitionRound.findUnique({
    where: { id: roundId },
    select: { competitionId: true, timeAllowedSec: true, timeLimitSec: true, competition: { select: { centreId: true } } },
  });
  if (!round || round.competitionId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && round.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const efforts = await prisma.jumpEffort.findMany({
    where: { roundId, entryId },
    orderBy: { fenceNo: "asc" },
  });
  const aggregate = await prisma.competitionRoundScore.findUnique({
    where: { roundId_entryId: { roundId, entryId } },
  });

  return NextResponse.json({
    efforts,
    aggregate,
    timeAllowedSec: round.timeAllowedSec,
    timeLimitSec: round.timeLimitSec,
  });
}
