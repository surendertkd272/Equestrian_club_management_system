import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const fenceSchema = z.object({
  fenceNo: z.string().min(1).max(8),
  orderIndex: z.coerce.number().int().min(0).max(60).default(0),
  heightCm: z.coerce.number().int().min(0).max(220).optional().nullable(),
  spreadCm: z.coerce.number().int().min(0).max(500).optional().nullable(),
  type: z.string().max(30).optional().nullable(),
  notes: z.string().max(200).optional().nullable(),
});

const replaceCourseSchema = z.object({
  fences: z.array(fenceSchema).max(40),
  // Cross-country tuning lives on the round itself.
  timeAllowedSec: z.coerce.number().min(0).max(2400).optional().nullable(),
  timeLimitSec: z.coerce.number().min(0).max(3600).optional().nullable(),
  optimumTimeSec: z.coerce.number().min(0).max(3600).optional().nullable(),
  speedMpm: z.coerce.number().int().min(0).max(800).optional().nullable(),
  courseLengthM: z.coerce.number().int().min(0).max(50000).optional().nullable(),
});

// GET /api/competitions/[id]/rounds/[roundId]/course — fetch course
// design + round timing knobs. Both fields are optional; if unset, the
// round runs without time penalties.
export async function GET(_req: NextRequest, { params }: { params: { id: string; roundId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const round = await prisma.competitionRound.findUnique({
    where: { id: params.roundId },
    include: { fences: { orderBy: { orderIndex: "asc" } }, competition: { select: { centreId: true } } },
  });
  if (!round || round.competitionId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && round.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return NextResponse.json({
    round: {
      id: round.id,
      className: round.className,
      roundNumber: round.roundNumber,
      name: round.name,
      phase: round.phase,
      timeAllowedSec: round.timeAllowedSec,
      timeLimitSec: round.timeLimitSec,
      optimumTimeSec: round.optimumTimeSec,
      speedMpm: round.speedMpm,
      courseLengthM: round.courseLengthM,
    },
    fences: round.fences,
  });
}

// PUT — replace the course design + round timing in one shot.
export async function PUT(req: NextRequest, { params }: { params: { id: string; roundId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = replaceCourseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });

  const round = await prisma.competitionRound.findUnique({
    where: { id: params.roundId },
    select: { competitionId: true, competition: { select: { centreId: true } } },
  });
  if (!round || round.competitionId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && round.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await prisma.$transaction([
    prisma.courseFence.deleteMany({ where: { roundId: params.roundId } }),
    prisma.courseFence.createMany({
      data: parsed.data.fences.map((f) => ({
        roundId: params.roundId,
        fenceNo: f.fenceNo,
        orderIndex: f.orderIndex,
        heightCm: f.heightCm ?? null,
        spreadCm: f.spreadCm ?? null,
        type: f.type ?? null,
        notes: f.notes ?? null,
      })),
    }),
    prisma.competitionRound.update({
      where: { id: params.roundId },
      data: {
        timeAllowedSec: parsed.data.timeAllowedSec ?? null,
        timeLimitSec: parsed.data.timeLimitSec ?? null,
        optimumTimeSec: parsed.data.optimumTimeSec ?? null,
        speedMpm: parsed.data.speedMpm ?? null,
        courseLengthM: parsed.data.courseLengthM ?? null,
      },
    }),
  ]);

  await audit({
    userId: session.userId,
    action: "competition.course_design_saved",
    tableName: "competitionRound",
    rowId: params.roundId,
    after: { fenceCount: parsed.data.fences.length },
  });
  return NextResponse.json({ ok: true });
}
