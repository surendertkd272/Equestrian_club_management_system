import { prisma } from "../prisma";
import { SweepResult } from "./shared";

// Equipment low-stock sweep — backstop in case the threshold was lowered
// by an admin (no stock-PATCH that would naturally trigger the dip check).
// Calls the same notify helper used by the PATCH route, so dedup is
// preserved: each (centre, item) gets one notification per dip cycle.
export async function sweepEquipmentLowStock(): Promise<SweepResult> {
  const stocks = await prisma.equipmentStock.findMany({
    include: { catalog: { select: { id: true, name: true, defaultThreshold: true, unit: true } } },
  });
  let scanned = 0;
  let notified = 0;
  let skipped = 0;
  for (const s of stocks) {
    scanned++;
    const threshold = s.threshold ?? s.catalog.defaultThreshold;
    if (s.qty >= threshold) continue;
    if (s.lastLowNotifiedAt && (!s.lastRestockedAt || s.lastLowNotifiedAt > s.lastRestockedAt)) {
      skipped++;
      continue;
    }
    // Re-use the on-write notifier; it handles recipient lookup + stamp.
    const mod = await import("../equipment-notify");
    await mod.notifyLowStockIfCrossed({
      stockId: s.id,
      centreId: s.centreId,
      catalogId: s.catalog.id,
      catalogName: s.catalog.name,
      qty: s.qty,
      threshold,
      unit: s.catalog.unit,
    });
    notified++;
  }
  return { job: "equipment_low_stock", scanned, notified, skipped };
}
