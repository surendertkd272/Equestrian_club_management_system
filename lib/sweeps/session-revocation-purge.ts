import { prisma } from "../prisma";
import { SweepResult } from "./shared";

// Drop revocation rows for tokens that have expired on their own.
//
// A denylist entry only has to outlive the token it revokes: once the JWT's own
// `exp` has passed, verifySession() rejects it regardless and the row is dead
// weight. Small grace period so a clock skew between the app and the database
// can't retire an entry while the token is still presentable.
export async function sweepSessionRevocationPurge(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - 60 * 60_000);
  const { count } = await prisma.revokedSession.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return { job: "session_revocation_purge", scanned: count, notified: 0, skipped: 0 };
}
