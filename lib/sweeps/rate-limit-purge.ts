import { prisma } from "../prisma";
import { SweepResult } from "./shared";

// Drop rate-limit windows that have closed. The limiter (lib/rate-limit.ts)
// never reads an expired row — the window key alone makes it unreachable — so
// this is pure housekeeping to stop the table growing without bound.
//
// A small grace period keeps rows around slightly past expiry rather than
// racing a check that is mid-flight against the boundary.
export async function sweepRateLimitPurge(): Promise<SweepResult> {
  // Epoch ms — the column is BIGINT, not a timestamp (see the model comment).
  const cutoff = BigInt(Date.now() - 60 * 60_000);
  const { count } = await prisma.rateLimitCounter.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return { job: "rate_limit_purge", scanned: count, notified: 0, skipped: 0 };
}
