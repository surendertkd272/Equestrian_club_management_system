// Low-stock notification — fires ONCE per dip cycle.
//
// Dedup logic: lastLowNotifiedAt is stamped after a notification goes out.
// It is cleared again when the stock row's qty goes UP (the upsert in the
// PATCH route clears it on restock). So a centre that lets an item sit
// below threshold gets one notification, not one per save; the next cycle
// only re-fires after the item has been restocked above threshold and
// then dipped again.
//
// Recipients per low-stock event:
//   • Centre's INVENTORY_MANAGER (and STABLE_MANAGER if no inventory manager)
//   • Every SUPER_ADMIN
// Both messages carry the same `type` and `link` so they show as a single
// thread in each inbox.

import { prisma } from "./prisma";
import { notify } from "./notify";

export async function notifyLowStockIfCrossed(input: {
  stockId: string;
  centreId: string;
  catalogId: string;
  catalogName: string;
  qty: number;
  threshold: number;
  unit: string;
}) {
  const stock = await prisma.equipmentStock.findUnique({ where: { id: input.stockId } });
  if (!stock) return;
  // Dedup: skip if already notified after the last restock.
  if (stock.lastLowNotifiedAt && (!stock.lastRestockedAt || stock.lastLowNotifiedAt > stock.lastRestockedAt)) {
    return;
  }

  const [centre, recipients] = await Promise.all([
    prisma.centre.findUnique({ where: { id: input.centreId }, select: { name: true } }),
    prisma.user.findMany({
      where: {
        OR: [
          { centreId: input.centreId, role: { in: ["INVENTORY_MANAGER", "STABLE_MANAGER"] as any }, status: "active" },
          { role: "SUPER_ADMIN" as any, status: "active" },
        ],
      },
      select: { id: true, role: true },
    }),
  ]);

  const title = `Low stock · ${input.catalogName}`;
  const body = `${centre?.name ?? "Centre"} is at ${input.qty} ${input.unit}${
    input.qty === 1 ? "" : "s"
  } (reorder at ${input.threshold}). Place a replenishment order.`;
  const link = `/equipment?centreId=${input.centreId}`;
  for (const r of recipients) {
    // notify() honours per-user prefs; we want this one to land so we mark
    // it critical — low stock blocks operations and shouldn't be muted.
    await notify({
      userId: r.id,
      centreId: input.centreId,
      type: "equipment.low_stock",
      title,
      body,
      link,
      criticality: "critical",
    });
  }

  await prisma.equipmentStock.update({
    where: { id: input.stockId },
    data: { lastLowNotifiedAt: new Date() },
  });
}
