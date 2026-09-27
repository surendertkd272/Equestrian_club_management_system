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
  // Fall back to the HIGHEST level they still hold, not the most recent
  // certificate: a re-sit of Level 1 after passing Level 2 is newer but lower.
  const rolledBackTo = await highestLivePromotion(db, cert.riderId, cert.id);
  await db.rider.update({
    where: { id: cert.riderId },
    data: { currentLevel: rolledBackTo },
  });
  return rolledBackTo;
}

// Undo a revocation's effect on the rider's level. Only ever RAISES the level:
// if the rider has moved past the certificate's level since it was revoked,
// restoring it would demote them (un-revoking an old Level 1 certificate used
// to put a Level 2 rider back to Level 1). A level we can't place on the
// ladder is left alone unless the rider has none at all.
export async function restoreLevelOnUnrevoke(
  db: Db,
  cert: { type: string; levelName: string | null; riderId: string | null },
): Promise<string | undefined> {
  if (cert.type !== "promotion" || !cert.levelName || !cert.riderId) return undefined;
  const rider = await db.rider.findUnique({
    where: { id: cert.riderId },
    select: { currentLevel: true, centreId: true },
  });
  if (!rider || rider.currentLevel === cert.levelName) return undefined;
  if (rider.currentLevel) {
    const [certRank, currentRank] = await Promise.all([
      levelRank(db, rider.centreId, cert.levelName),
      levelRank(db, rider.centreId, rider.currentLevel),
    ]);
    if (certRank === null || currentRank === null || certRank <= currentRank) return undefined;
  }
  await db.rider.update({ where: { id: cert.riderId }, data: { currentLevel: cert.levelName } });
  return cert.levelName;
}

// Position of a level on the club's ladder: the centre's scoring template for
// that level name (levelKey "1".."n"), else the general level catalog.
export async function levelRank(db: Db, centreId: string, levelName: string): Promise<number | null> {
  const t = await db.scoringTemplate.findFirst({
    where: { centreId, levelName },
    select: { levelKey: true },
  });
  const fromTemplate = t ? Number(t.levelKey) : NaN;
  if (Number.isFinite(fromTemplate)) return fromTemplate;
  const cat = await db.examLevel.findFirst({
    where: { discipline: "general", name: levelName },
    select: { orderIndex: true },
  });
  return cat ? cat.orderIndex : null;
}

// The highest-ranked live promotion a rider holds, optionally ignoring one
// certificate (the one being revoked). Ties and unranked levels fall back to
// the most recently issued.
async function highestLivePromotion(db: Db, riderId: string, excludeCertId?: string): Promise<string | null> {
  const [rider, held] = await Promise.all([
    db.rider.findUnique({ where: { id: riderId }, select: { centreId: true } }),
    db.certificate.findMany({
      where: {
        riderId,
        type: "promotion",
        revokedAt: null,
        levelName: { not: null },
        ...(excludeCertId ? { id: { not: excludeCertId } } : {}),
      },
      orderBy: { issuedAt: "desc" },
      select: { levelName: true },
    }),
  ]);
  if (!rider || held.length === 0) return null;
  let best: { name: string; rank: number } | null = null;
  for (const h of held) {
    const rank = (await levelRank(db, rider.centreId, h.levelName!)) ?? -1;
    if (!best || rank > best.rank) best = { name: h.levelName!, rank };
  }
  return best?.name ?? null;
}
