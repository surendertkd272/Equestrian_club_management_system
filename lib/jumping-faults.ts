// FEI Table A faults math for show jumping. Pure functions — no DB. Called
// from the per-fence scoring API and the scoresheet UI for live totals.
//
// Rules:
//   • knockdown            = 4 faults each
//   • 1st refusal at fence = 4 faults
//   • 2nd refusal at fence = 4 faults
//   • 3rd refusal at fence = elimination
//   • fall (horse or rider) = elimination
//   • time over allowed     = ceil((time − timeAllowed) / 4) faults, 1 fault per started 4-second period
//
// Eliminations short-circuit fault totalling — show "ELIMINATED" with the
// fence number where it occurred.

export type JumpEffortInput = {
  fenceNo: string;
  knockdown: boolean;
  refusal: number;     // count at this specific fence
  eliminated: boolean;
  fall: boolean;
};

export type JumpResult =
  | { ok: true; faults: number; eliminated: false }
  | { ok: false; eliminated: true; reason: string; firstEliminatedAtFence: string };

export function computeJumpFaults(efforts: JumpEffortInput[], timeSec: number | null, timeAllowedSec: number | null): JumpResult {
  for (const e of efforts) {
    if (e.eliminated || e.refusal >= 3 || e.fall) {
      return {
        ok: false,
        eliminated: true,
        reason: e.fall ? "Fall" : e.refusal >= 3 ? "3rd refusal" : "Marked eliminated",
        firstEliminatedAtFence: e.fenceNo,
      };
    }
  }
  let faults = 0;
  for (const e of efforts) {
    if (e.knockdown) faults += 4;
    faults += Math.min(e.refusal, 2) * 4;
  }
  if (timeSec !== null && timeAllowedSec !== null && timeSec > timeAllowedSec) {
    const over = timeSec - timeAllowedSec;
    faults += Math.ceil(over / 4);
  }
  return { ok: true, faults, eliminated: false };
}
