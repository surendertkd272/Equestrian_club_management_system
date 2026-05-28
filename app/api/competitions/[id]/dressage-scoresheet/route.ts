import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { computeDressagePercentage, combineDressageSheets, type DressageMovement, type DressageCollective, type JudgingMode } from "@/lib/dressage";
import { dressagePercentageToPenalty } from "@/lib/eventing";

const markSchema = z.object({
  no: z.number().int().min(1),
  mark: z.number().min(0).max(10).nullable(),
  comment: z.string().max(200).optional(),
});
const submitSchema = z.object({
  roundId: z.string().min(1),
  entryId: z.string().min(1),
  testId: z.string().min(1),
  judgePosition: z.string().max(4).optional().nullable(),
  marks: z.array(markSchema).max(60),
  collectives: z.array(markSchema).max(10),
  notes: z.string().max(1000).optional().nullable(),
  finalSubmit: z.boolean().default(false),
});

// POST /api/competitions/[id]/dressage-scoresheet — upsert one judge's
// scoresheet for one (round, entry). finalSubmit=true stamps submittedAt
// and locks the percentage onto CompetitionEntry.score (averaged across
// all judges' submitted sheets). Drafts (finalSubmit=false) save without
// affecting the public score.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const [round, entry, test, comp] = await Promise.all([
    prisma.competitionRound.findUnique({ where: { id: d.roundId }, select: { id: true, competitionId: true, className: true } }),
    prisma.competitionEntry.findUnique({ where: { id: d.entryId }, select: { id: true, competitionId: true, className: true } }),
    prisma.dressageTest.findUnique({ where: { id: d.testId } }),
    prisma.competition.findUnique({ where: { id: params.id }, select: { centreId: true } }),
  ]);
  if (!round || round.competitionId !== params.id) return NextResponse.json({ error: "ROUND_NOT_FOUND" }, { status: 404 });
  if (!entry || entry.competitionId !== params.id || entry.className !== round.className) {
    return NextResponse.json({ error: "ENTRY_ROUND_MISMATCH" }, { status: 400 });
  }
  if (!test) return NextResponse.json({ error: "TEST_NOT_FOUND" }, { status: 404 });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // movementsJson / collectiveMarksJson on DressageTest are jsonb columns —
  // Prisma returns the parsed arrays directly.
  const movements = (Array.isArray(test.movementsJson) ? test.movementsJson : []) as DressageMovement[];
  const collectives = (Array.isArray(test.collectiveMarksJson) ? test.collectiveMarksJson : []) as DressageCollective[];

  const percentage = computeDressagePercentage(
    d.marks as { no: number; mark: number | null }[],
    d.collectives as { no: number; mark: number | null }[],
    movements,
    collectives,
    test.maxScore,
  );

  const sheet = await prisma.dressageScoresheet.upsert({
    where: {
      roundId_entryId_judgeUserId: {
        roundId: round.id,
        entryId: entry.id,
        judgeUserId: session.userId,
      },
    },
    create: {
      roundId: round.id,
      entryId: entry.id,
      testId: test.id,
      judgeUserId: session.userId,
      judgePosition: d.judgePosition ?? null,
      // jsonb columns — pass the arrays directly.
      marksJson: d.marks,
      collectiveMarksJson: d.collectives,
      percentage,
      notes: d.notes ?? null,
      submittedAt: d.finalSubmit ? new Date() : null,
    },
    update: {
      testId: test.id,
      judgePosition: d.judgePosition ?? null,
      marksJson: d.marks,
      collectiveMarksJson: d.collectives,
      percentage,
      notes: d.notes ?? null,
      submittedAt: d.finalSubmit ? new Date() : undefined,
    },
  });

  // After final-submit, re-combine all submitted sheets for this (round,
  // entry) using the round's configured judgingMode. Default mode is
  // "simple" (straight average); FEI 5-judge panels can use "trimmed_mean"
  // or "per_movement" instead. The combined percentage lands on the
  // round score's `score` field; if the round is part of an eventing
  // class with a configured `dressagePenaltyFactor`, we ALSO compute the
  // CCI penalty and store it on the round score's `faults` field so the
  // eventing combined ranker can sum across phases.
  if (d.finalSubmit) {
    const allSubmitted = await prisma.dressageScoresheet.findMany({
      where: { roundId: round.id, entryId: entry.id, submittedAt: { not: null }, percentage: { not: null } },
      select: { judgeUserId: true, judgePosition: true, percentage: true, marksJson: true, collectiveMarksJson: true },
    });
    if (allSubmitted.length > 0) {
      const fullRound = await prisma.competitionRound.findUnique({
        where: { id: round.id },
        select: { judgingMode: true, dressagePenaltyFactor: true },
      });
      const mode = (fullRound?.judgingMode ?? "simple") as JudgingMode;
      const combined = combineDressageSheets(allSubmitted, mode, movements, collectives, test.maxScore);
      const combinedPct = combined.percentage;
      const cciPenalty = combinedPct !== null && fullRound?.dressagePenaltyFactor
        ? dressagePercentageToPenalty(combinedPct, fullRound.dressagePenaltyFactor)
        : null;

      await prisma.$transaction([
        prisma.competitionRoundScore.upsert({
          where: { roundId_entryId: { roundId: round.id, entryId: entry.id } },
          create: { roundId: round.id, entryId: entry.id, score: combinedPct, faults: cciPenalty },
          update: { score: combinedPct, faults: cciPenalty },
        }),
        // Mirror onto CompetitionEntry. For non-eventing dressage,
        // score=percentage drives the existing dressage ranker.
        // For eventing rounds, the combined-rank recomputer (called via
        // recomputeEventingCombined below) will overwrite this with the
        // multi-phase total.
        prisma.competitionEntry.update({
          where: { id: entry.id },
          data: { score: combinedPct, faults: cciPenalty },
        }),
      ]);

      // If this dressage round is part of an eventing competition, the
      // combined-rank helper sums across phases and updates the entry's
      // `score` to the running total (lower = better for eventing).
      const compForRank = await prisma.competition.findUnique({
        where: { id: params.id },
        select: { discipline: true },
      });
      if (compForRank?.discipline === "eventing") {
        const { recomputeEventingCombined } = await import("@/lib/eventing-combined");
        await recomputeEventingCombined(entry.id);
      }
    }
  }

  await audit({
    userId: session.userId,
    action: d.finalSubmit ? "competition.dressage_submitted" : "competition.dressage_draft",
    tableName: "dressageScoresheet",
    rowId: sheet.id,
    after: { roundId: round.id, entryId: entry.id, percentage },
  });

  return NextResponse.json({ ok: true, id: sheet.id, percentage });
}

// GET /api/competitions/[id]/dressage-scoresheet?roundId=&entryId=
// Hydrates the judge's own draft or any submitted sheet for this (round, entry).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const url = new URL(req.url);
  const roundId = url.searchParams.get("roundId");
  const entryId = url.searchParams.get("entryId");
  if (!roundId || !entryId) return NextResponse.json({ error: "BAD_QUERY" }, { status: 400 });

  const round = await prisma.competitionRound.findUnique({
    where: { id: roundId },
    select: {
      competitionId: true,
      dressageTestId: true,
      dressageTest: true,
      competition: { select: { centreId: true } },
    },
  });
  if (!round || round.competitionId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && round.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const sheets = await prisma.dressageScoresheet.findMany({
    where: { roundId, entryId },
    orderBy: { createdAt: "asc" },
  });
  const mySheet = sheets.find((s) => s.judgeUserId === session.userId) ?? null;

  return NextResponse.json({
    test: round.dressageTest,
    sheets, // visible to all so judges can see each other's submissions
    mySheet,
  });
}
