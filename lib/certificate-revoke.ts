import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

// Soft-revoke one certificate and, for a promotion, roll the rider's level
// back. Shared by the manual revoke route and by an exam that is re-scored as
// "did not pass" after being reopened — both must leave the rider exactly where
// the certificate found them.
//
// Returns the level the rider was rolled back to, or undefined when their
// level was left alone.
export async function revokeCertificate(
  db: Db,
  cert: { id: string; type: string; levelName: string | null; riderId: string | null },
  userId: string,
  reason: string,
): Promise<string | null | undefined> {
  await db.certificate.update({
    where: { id: cert.id },
    data: { revokedAt: new Date(), revokedBy: userId, revokeReason: reason },
  });

  // Scoring a pass promotes the rider (lib/exam-panel.ts), so revoking the
  // certificate that promoted them has to undo it — otherwise the club
  // withdraws the certificate while the rider keeps the rank it granted, stays
  // in the higher batch, and is entered for the next level up on the strength
  // of an award that no longer exists.
  //
  // Only when the revoked certificate is the one holding them at that level:
  // if they still hold another live promotion for it, nothing changes. Falls
  // back to the most recent live promotion, or null for a rider whose only
  // promotion was this one.
  if (cert.type !== "promotion" || !cert.levelName || !cert.riderId) return undefined;
  const rider = await db.rider.findUnique({
    where: { id: cert.riderId },
    select: { currentLevel: true },
  });
  if (rider?.currentLevel !== cert.levelName) return undefined;
  const stillHeld = await db.certificate.findFirst({
    where: { riderId: cert.riderId, type: "promotion", revokedAt: null, id: { not: cert.id } },
    orderBy: { issuedAt: "desc" },
    select: { levelName: true },
  });
  const rolledBackTo = stillHeld?.levelName ?? null;
  await db.rider.update({
    where: { id: cert.riderId },
    data: { currentLevel: rolledBackTo },
  });
  return rolledBackTo;
}
