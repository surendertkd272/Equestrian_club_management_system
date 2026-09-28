import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

// Link a centre manager as THE manager of their centre when the centre has
// none yet. Creating a CENTRE_MANAGER never set Centre.managerId, and nothing
// else did either, so a centre created in the app had no manager on record:
// the Centres list showed none and centre-manager notifications had nobody to
// go to. Only fills an empty slot — an existing link is changed deliberately,
// from the centre's settings.
export async function linkCentreManagerIfUnset(db: Db, centreId: string | null | undefined, userId: string) {
  if (!centreId) return;
  await db.centre.updateMany({ where: { id: centreId, managerId: null }, data: { managerId: userId } });
}
