// Recycle-bin shared logic. Soft-deleted catalog rows (active=false, with a
// deletedAt stamp) live here until restored or purged. Auto-purge after 30
// days runs from the daily sweep. Centre-scoped; HQ sees all.

import { prisma } from "./prisma";

export const BIN_RETENTION_DAYS = 30;

// Entities that participate in the bin. Each maps to a Prisma delegate +
// human label + the field holding the display name. Kept as a string union
// so the API + UI agree on the keys.
export const BIN_ENTITIES = ["vendor", "medicine", "consumable", "team"] as const;
export type BinEntity = (typeof BIN_ENTITIES)[number];

export const BIN_LABEL: Record<BinEntity, string> = {
  vendor: "Vendor",
  medicine: "Medicine",
  consumable: "Consumable",
  team: "Team / Squad",
};

export function isBinEntity(v: string): v is BinEntity {
  return (BIN_ENTITIES as readonly string[]).includes(v);
}

// Returns the Prisma delegate for an entity (typed loosely on purpose — every
// one of these models has id/centreId/active/deletedAt + a name field).
export function delegateFor(entity: BinEntity): any {
  switch (entity) {
    case "vendor": return prisma.vendor;
    case "medicine": return prisma.medicine;
    case "consumable": return prisma.consumable;
    case "team": return prisma.team;
  }
}
