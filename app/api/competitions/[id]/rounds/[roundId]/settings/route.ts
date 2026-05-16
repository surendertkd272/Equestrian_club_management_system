import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// PATCH /api/competitions/[id]/rounds/[roundId]/settings — federation-
// specific round knobs that don't fit on the course-design endpoint:
//   • judgingMode             — CDI dressage averaging variant
//   • dressagePenaltyFactor   — CCI eventing dressage→penalty factor
//   • dressageTestId          — which DressageTest the round uses
const schema = z.object({
  judgingMode: z.enum(["simple", "trimmed_mean", "per_movement"]).optional().nullable(),
  dressagePenaltyFactor: z.coerce.number().min(0).max(5).optional().nullable(),
  dressageTestId: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string; roundId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });

  const round = await prisma.competitionRound.findUnique({
    where: { id: params.roundId },
    select: { competitionId: true, competition: { select: { centreId: true } } },
  });
  if (!round || round.competitionId !== params.id) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && round.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const updated = await prisma.competitionRound.update({
    where: { id: params.roundId },
    data: {
      ...(parsed.data.judgingMode !== undefined ? { judgingMode: parsed.data.judgingMode } : {}),
      ...(parsed.data.dressagePenaltyFactor !== undefined ? { dressagePenaltyFactor: parsed.data.dressagePenaltyFactor } : {}),
      ...(parsed.data.dressageTestId !== undefined ? { dressageTestId: parsed.data.dressageTestId } : {}),
    },
    select: { id: true, judgingMode: true, dressagePenaltyFactor: true, dressageTestId: true },
  });

  await audit({
    userId: session.userId,
    action: "competition.round_settings_updated",
    tableName: "competitionRound",
    rowId: params.roundId,
    after: updated,
  });

  return NextResponse.json({ ok: true, round: updated });
}
