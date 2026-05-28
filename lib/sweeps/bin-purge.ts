import { prisma } from "../prisma";
import { SweepResult } from "./shared";

// Recycle-bin auto-purge — permanently delete soft-deleted rows older than
// 30 days. Best-effort per row: items still referenced by history (FK) are
// skipped and stay in the bin rather than erroring the whole sweep.
//
// Coverage: the four models below are the ONLY ones in the schema with a
// `deletedAt: DateTime?` column. Catalog models like EquipmentCatalog,
// ExpenseCategory, ChecklistTemplate, TicketTier have `active: Boolean`
// only — those get deactivated and stay forever because historical rows
// (expenses, submissions, tickets) reference them by id. If you add a new
// `deletedAt` column to any model, add it to BIN_MODELS below.
//
// The minimal "delegate" interface below is enough to call findMany/delete
// across the four models — keeps the code untyped-cast-free at the call
// sites in the loop below. Prisma's generated delegates don't have a clean
// union we can spell here without a `keyof PrismaClient` trick that breaks
// when the schema changes; the structural type is honest about what we use.
type BinWhere = { active: false; deletedAt: { lt: Date } };
type BinDelegate = {
  findMany: (args: { where: BinWhere; select: { id: true } }) => Promise<Array<{ id: string }>>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
};

const BIN_MODELS: { name: string; delegate: BinDelegate }[] = [
  { name: "vendor", delegate: prisma.vendor as unknown as BinDelegate },
  { name: "medicine", delegate: prisma.medicine as unknown as BinDelegate },
  { name: "consumable", delegate: prisma.consumable as unknown as BinDelegate },
  { name: "team", delegate: prisma.team as unknown as BinDelegate },
];

export async function sweepBinPurge(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const where: BinWhere = { active: false, deletedAt: { lt: cutoff } };
  let purged = 0;
  let skipped = 0;
  for (const m of BIN_MODELS) {
    const rows = await m.delegate.findMany({ where, select: { id: true } });
    for (const r of rows) {
      try {
        await m.delegate.delete({ where: { id: r.id } });
        purged += 1;
      } catch {
        // FK-referenced (expenses / usages / movements / members) — leave it.
        skipped += 1;
      }
    }
  }
  return { job: "bin_purge", scanned: purged + skipped, notified: purged, skipped };
}
