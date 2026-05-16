// Gymkhana scoring & combined-rank math.
//
// Each game in a class has its own ranking. The class winner is the rider
// whose summed per-game positions is lowest (ties broken by total time).
//
// For "time" games, an effective time = raw time + (faults × penaltyPerFault).
// Eliminated entries get a sentinel "DNF position" = (number_of_competitors_in_game + 1)
// so they don't get position 1 by accident.
// For "points" games, highest score wins.

export type GameInput = {
  id: string;
  scoringType: "time" | "points";
  penaltyPerFault: number;
};

export type ResultInput = {
  gameId: string;
  entryId: string;
  time: number | null;
  faults: number;
  points: number | null;
  eliminated: boolean;
};

// Returns a Map<gameId, Array<{ entryId, position }>>.
export function rankGameResults(
  games: GameInput[],
  results: ResultInput[],
): Map<string, Array<{ entryId: string; position: number; effectiveTime?: number; points?: number; eliminated: boolean }>> {
  const out = new Map<string, Array<{ entryId: string; position: number; effectiveTime?: number; points?: number; eliminated: boolean }>>();
  for (const g of games) {
    const rs = results.filter((r) => r.gameId === g.id);
    const dnfPos = rs.length + 1;
    if (g.scoringType === "time") {
      const ranked = rs
        .map((r) => ({
          entryId: r.entryId,
          eliminated: r.eliminated || r.time === null,
          effectiveTime: r.time === null ? Number.POSITIVE_INFINITY : r.time + r.faults * g.penaltyPerFault,
        }))
        .sort((a, b) => a.effectiveTime - b.effectiveTime);
      let pos = 1;
      const rows: Array<{ entryId: string; position: number; effectiveTime: number; eliminated: boolean }> = [];
      for (const x of ranked) {
        rows.push({ entryId: x.entryId, position: x.eliminated ? dnfPos : pos, effectiveTime: x.effectiveTime, eliminated: x.eliminated });
        if (!x.eliminated) pos++;
      }
      out.set(g.id, rows);
    } else {
      const ranked = rs
        .map((r) => ({
          entryId: r.entryId,
          eliminated: r.eliminated || r.points === null,
          points: r.points ?? -Number.POSITIVE_INFINITY,
        }))
        .sort((a, b) => b.points - a.points);
      let pos = 1;
      const rows: Array<{ entryId: string; position: number; points: number; eliminated: boolean }> = [];
      for (const x of ranked) {
        rows.push({ entryId: x.entryId, position: x.eliminated ? dnfPos : pos, points: x.points, eliminated: x.eliminated });
        if (!x.eliminated) pos++;
      }
      out.set(g.id, rows);
    }
  }
  return out;
}

// Combined: sum of per-game positions per entry; lower aggregate wins.
// Tie-break: sum of effective times (only meaningful for all-time series).
export function computeCombined(
  rankedByGame: Map<string, Array<{ entryId: string; position: number; effectiveTime?: number }>>,
): Array<{ entryId: string; combinedPosSum: number; totalEffectiveTime: number }> {
  const agg = new Map<string, { combinedPosSum: number; totalEffectiveTime: number }>();
  for (const rows of rankedByGame.values()) {
    for (const r of rows) {
      const slot = agg.get(r.entryId) ?? { combinedPosSum: 0, totalEffectiveTime: 0 };
      slot.combinedPosSum += r.position;
      slot.totalEffectiveTime += Number.isFinite(r.effectiveTime ?? 0) ? r.effectiveTime ?? 0 : 9999;
      agg.set(r.entryId, slot);
    }
  }
  return Array.from(agg.entries())
    .map(([entryId, v]) => ({ entryId, ...v }))
    .sort((a, b) => a.combinedPosSum - b.combinedPosSum || a.totalEffectiveTime - b.totalEffectiveTime);
}
