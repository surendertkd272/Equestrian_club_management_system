// Cross-country time penalty conversion. Most rule sets (FEI, EFI eventing)
// score a course as:
//   • 0.4 penalty points per started second over `optimumTimeSec`
//   • no benefit for finishing under optimum (some lower-tier rule sets
//     award faster times tie-breaks; we don't model that here)
//   • exceeding the time limit (typically 2× optimum) = elimination

export function crossCountryTimePenalties(timeSec: number, optimumSec: number, hardLimitSec?: number | null): {
  penalty: number;
  eliminated: boolean;
  reason?: string;
} {
  if (hardLimitSec && timeSec > hardLimitSec) {
    return { penalty: 0, eliminated: true, reason: "Time limit exceeded" };
  }
  if (timeSec <= optimumSec) return { penalty: 0, eliminated: false };
  const over = timeSec - optimumSec;
  // Per-started-second model: every second commenced counts.
  const penalty = Math.ceil(over) * 0.4;
  // Round to 1 decimal to avoid floating crud (0.4000000001).
  return { penalty: Math.round(penalty * 10) / 10, eliminated: false };
}
