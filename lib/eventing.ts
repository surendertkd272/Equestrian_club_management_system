// CCI / FEI eventing penalty math + combined-rank helpers.
//
// Eventing combines three phases into one penalty total. Lowest total
// wins. The phases use different units, all converted to penalty
// points before summing:
//
//   • Dressage: percentage → penalty via (100 − %) × factor.
//                Factor is rule-set dependent — FEI 2020+ uses 0.4,
//                older rule sets used 0.6, lower-tier may use 1.0.
//   • Cross-country: 20 per refusal (1st), +40 per refusal (2nd at
//                same fence), 3rd refusal = elimination. Fall =
//                elimination. Time: 0.4 per started second over
//                optimum.
//   • Show jumping: FEI Table A (4 per knockdown, 4 per refusal, 3rd
//                refusal = elimination, time: 1 fault per started 4s
//                over allowed).
//
// We keep the three pure functions here so the route handlers in
// jump-scores, dressage-scoresheet, and xc-scores can all sum penalties
// onto CompetitionRoundScore consistently.

export function dressagePercentageToPenalty(percentage: number, factor: number): number {
  if (factor <= 0) return 0;
  const penalty = (100 - percentage) * factor;
  return Math.round(penalty * 10) / 10;
}

export type XcEffortInput = {
  fenceNo: string;
  refusal: number;        // count of refusals at this specific fence
  eliminated: boolean;    // operator override
  fall: boolean;
};

export type XcResult =
  | { ok: true; faults: number; eliminated: false }
  | { ok: false; eliminated: true; reason: string; firstEliminatedAtFence: string };

// FEI Eventing 549.2 cross-country faults math.
//   • 1st refusal at a fence: 20
//   • 2nd refusal at same fence: 40 more (so 60 total at that fence)
//   • 3rd refusal at the same fence: elimination
//   • Total of 3 refusals across the whole course: elimination (some rule
//     sets — we enforce the per-fence rule, leave course-total elimination
//     to the operator via the eliminated flag)
//   • Fall of horse or rider: elimination
//   • Time penalties: 0.4 per started second over optimum.
export function computeXcFaults(
  efforts: XcEffortInput[],
  timeSec: number | null,
  optimumSec: number | null,
): XcResult {
  for (const e of efforts) {
    if (e.fall) {
      return { ok: false, eliminated: true, reason: "Fall", firstEliminatedAtFence: e.fenceNo };
    }
    if (e.eliminated) {
      return { ok: false, eliminated: true, reason: "Marked eliminated", firstEliminatedAtFence: e.fenceNo };
    }
    if (e.refusal >= 3) {
      return {
        ok: false,
        eliminated: true,
        reason: "3rd refusal at fence " + e.fenceNo,
        firstEliminatedAtFence: e.fenceNo,
      };
    }
  }
  let faults = 0;
  for (const e of efforts) {
    if (e.refusal >= 1) faults += 20;
    if (e.refusal >= 2) faults += 40;
  }
  if (timeSec !== null && optimumSec !== null && timeSec > optimumSec) {
    const over = timeSec - optimumSec;
    faults += Math.ceil(over) * 0.4;
  }
  return { ok: true, faults: Math.round(faults * 10) / 10, eliminated: false };
}

// Sum penalties from each phase round into the entry's overall total.
// Rounds with elimination on any phase eliminate the entry overall.
export function combineEventingPhases(
  phases: Array<{ phase: string; penalty: number | null; eliminated: boolean }>,
): { combined: number | null; eliminated: boolean; eliminatedAt: string | null } {
  for (const p of phases) {
    if (p.eliminated) {
      return { combined: null, eliminated: true, eliminatedAt: p.phase };
    }
  }
  let sum = 0;
  let anyScored = false;
  for (const p of phases) {
    if (p.penalty !== null) {
      sum += p.penalty;
      anyScored = true;
    }
  }
  return {
    combined: anyScored ? Math.round(sum * 10) / 10 : null,
    eliminated: false,
    eliminatedAt: null,
  };
}
