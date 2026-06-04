import { prisma } from "../prisma";
import { SweepResult } from "./shared";

// Auto-purge finished onboarding links 90 days after they wrapped up. Only two
// kinds are deletable:
//   - draft links that expired without ever being completed (90d past expiry)
//   - rejected submissions (90d after the reject, tracked via updatedAt)
// Approved rows are KEPT forever — they're the hire's KYC source + feed the
// pending-documents tracker. Submitted rows (awaiting review) are never touched.
const RETENTION_DAYS = 90;

export async function sweepOnboardingLinkPurge(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const res = await prisma.employeeOnboarding.deleteMany({
    where: {
      OR: [
        { status: "draft", expiresAt: { lt: cutoff } },
        { status: "rejected", updatedAt: { lt: cutoff } },
      ],
    },
  });
  return { job: "onboarding_link_purge", scanned: res.count, notified: 0, skipped: 0 };
}
