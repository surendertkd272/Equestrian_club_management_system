// Eventing combined-rank recomputer. Sums per-phase penalties from all
// CompetitionRoundScore rows for one entry and writes the total back to
// CompetitionEntry. Called from each phase's scoring endpoint (dressage,
// xc, sj) on finalisation so the entry's `score` always reflects the
// latest running total.
//
// Convention for eventing entries (CompetitionEntry):
//   score   = combined penalty total (lower wins)
//   faults  = latest phase penalty (mostly for display)
//   time    = optional, used only for ties via fastest XC time
//
// The eventing discipline ranker in lib/discipline.ts already ranks
// ascending by score, so writing the combined total here means the
// scoreboard just works.

import { prisma } from "./prisma";
import { combineEventingPhases } from "./eventing";

export async function recomputeEventingCombined(entryId: string) {
  const entry = await prisma.competitionEntry.findUnique({
    where: { id: entryId },
    select: { id: true, competitionId: true, className: true },
  });
  if (!entry) return;

  const roundScores = await prisma.competitionRoundScore.findMany({
    where: { entryId, round: { competitionId: entry.competitionId, className: entry.className } },
    include: { round: { select: { phase: true, name: true } } },
  });

  const phases = roundScores.map((rs) => {
    // For dressage rounds the penalty lives on rs.faults (because score=%).
    // For xc + sj rounds the penalty lives on rs.faults directly.
    // notes="Eliminated…" + faults=null means the phase eliminated this entry.
    const eliminated = rs.notes !== null && /elim/i.test(rs.notes ?? "");
    return {
      phase: rs.round.phase ?? rs.round.name ?? "phase",
      penalty: rs.faults,
      eliminated,
    };
  });

  const combined = combineEventingPhases(phases);
  // Last phase's XC time goes onto the entry as the tie-break field.
  const xcRow = roundScores.find((rs) => rs.round.phase === "cross_country");
  await prisma.competitionEntry.update({
    where: { id: entry.id },
    data: {
      score: combined.combined,
      time: xcRow?.time ?? null,
      faults: combined.eliminated ? null : combined.combined,
      notes: combined.eliminated ? `Eliminated in ${combined.eliminatedAt}` : null,
    },
  });
}
