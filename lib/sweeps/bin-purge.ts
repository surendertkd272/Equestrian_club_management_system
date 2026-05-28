import { prisma } from "../prisma";
import { SweepResult } from "./shared";

// Recycle-bin auto-purge — permanently delete catalog rows soft-deleted more
// than 30 days ago. Best-effort per row: items still referenced by history
// (FK) are skipped and stay in the bin rather than erroring the whole sweep.
export async function sweepBinPurge(): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const where = { active: false, deletedAt: { lt: cutoff } } as const;
  const models: { name: string; delegate: any }[] = [
    { name: "vendor", delegate: prisma.vendor },
    { name: "medicine", delegate: prisma.medicine },
    { name: "consumable", delegate: prisma.consumable },
    { name: "team", delegate: prisma.team },
  ];
  let purged = 0;
  let skipped = 0;
  for (const m of models) {
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
