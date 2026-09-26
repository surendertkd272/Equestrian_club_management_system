import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyLowStockIfCrossed } from "@/lib/equipment-notify";
import type { updateStockSchema } from "@/lib/schemas/equipment";

export type StockChange = z.infer<typeof updateStockSchema>;

type Catalog = { id: string; name: string; unit: string; defaultThreshold: number };

// The one place an equipment stock row is written. Called directly by the
// stock route for roles that may adjust stock outright, and by the approval
// flow when a manager approves a change a coach asked for — so an approved
// change lands exactly as it would have had the manager typed it themselves:
// same row lock, same movement record, same low-stock alert.
//
// actorId is who the movement is attributed to. For an approved request that
// is the coach who asked for it; the approver is recorded on the request.
export async function applyStockChange(args: {
  centreId: string;
  catalog: Catalog;
  data: StockChange;
  actorId: string;
  approvalId?: string;
}) {
  const { centreId, catalog, data, actorId } = args;

  let newQty = 0;
  let newThreshold: number | null = null;
  let previousQty = 0;
  let beforeThreshold: number | null = null;

  // H2 — serialize concurrent adjustments for this (centre, catalog) pair: the
  // read → compute → upsert → movement runs under SELECT … FOR UPDATE, so two
  // delta writes can't both read the same prev value and lose an update. A
  // first-touch double-create (no row to lock yet) raises P2002 and is retried
  // once, by which time the row exists and takes the locked path.
  const runTx = () =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "EquipmentStock" WHERE "centreId" = ${centreId} AND "catalogId" = ${catalog.id} FOR UPDATE`;
      const existing = await tx.equipmentStock.findUnique({
        where: { centreId_catalogId: { centreId, catalogId: catalog.id } },
      });
      previousQty = existing?.qty ?? 0;
      beforeThreshold = existing?.threshold ?? null;
      const prevUnused = existing?.qtyUnused ?? 0;
      const prevInUse = existing?.qtyInUse ?? 0;
      const prevForRepair = existing?.qtyForRepair ?? 0;
      const prevDamaged = existing?.qtyDamaged ?? 0;

      let newUnused = data.qtyUnused ?? prevUnused;
      const newInUse = data.qtyInUse ?? prevInUse;
      const newForRepair = data.qtyForRepair ?? prevForRepair;
      const newDamaged = data.qtyDamaged ?? prevDamaged;
      // Legacy qty/delta path → treated as qtyUnused so the row stays correct.
      if (data.qty !== undefined) {
        newUnused = data.qty;
      } else if (data.delta !== undefined) {
        newUnused = Math.max(0, prevUnused + data.delta);
      }
      newQty = newUnused + newInUse; // cached "available" for the low-stock sweep
      newThreshold = data.threshold === undefined ? existing?.threshold ?? null : data.threshold;
      const isRestock = newQty > previousQty;

      const s = await tx.equipmentStock.upsert({
        where: { centreId_catalogId: { centreId, catalogId: catalog.id } },
        create: {
          centreId,
          catalogId: catalog.id,
          qty: newQty,
          qtyUnused: newUnused,
          qtyInUse: newInUse,
          qtyForRepair: newForRepair,
          qtyDamaged: newDamaged,
          newRequired: data.newRequired ?? 0,
          owner: data.owner ?? null,
          notes: data.notes ?? null,
          threshold: newThreshold,
          lastRestockedAt: isRestock ? new Date() : null,
        },
        update: {
          qty: newQty,
          qtyUnused: newUnused,
          qtyInUse: newInUse,
          qtyForRepair: newForRepair,
          qtyDamaged: newDamaged,
          ...(data.newRequired !== undefined ? { newRequired: data.newRequired } : {}),
          ...(data.owner !== undefined ? { owner: data.owner } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          threshold: newThreshold,
          ...(isRestock ? { lastRestockedAt: new Date(), lastLowNotifiedAt: null } : {}),
        },
      });

      if (data.qty !== undefined || data.delta !== undefined) {
        await tx.equipmentStockMovement.create({
          data: {
            stockId: s.id,
            delta: newQty - previousQty,
            reason: data.reason,
            notes: data.notes ?? null,
            actorId,
          },
        });
      }
      return s;
    });

  let stock: Awaited<ReturnType<typeof runTx>>;
  try {
    stock = await runTx();
  } catch (e: any) {
    if (e?.code === "P2002") stock = await runTx();
    else throw e;
  }

  await audit({
    userId: actorId,
    action: "equipment_stock.update",
    tableName: "equipmentStock",
    rowId: stock.id,
    before: { qty: previousQty, threshold: beforeThreshold },
    after: {
      qty: newQty,
      threshold: newThreshold,
      ...(args.approvalId ? { viaApproval: args.approvalId } : {}),
    },
  });

  const effectiveThreshold = newThreshold ?? catalog.defaultThreshold;
  if (newQty < effectiveThreshold) {
    await notifyLowStockIfCrossed({
      stockId: stock.id,
      centreId,
      catalogId: catalog.id,
      catalogName: catalog.name,
      qty: newQty,
      threshold: effectiveThreshold,
      unit: catalog.unit,
    });
  }

  return { stock, newQty, previousQty, threshold: effectiveThreshold };
}

// "Saddle pads: 10 → 4 (consumed)" — what the approver reads before deciding.
export function describeStockChange(catalogName: string, unit: string, currentQty: number, d: StockChange): string {
  const parts: string[] = [];
  if (d.qty !== undefined) parts.push(`set to ${d.qty} ${unit} (now ${currentQty})`);
  else if (d.delta !== undefined) parts.push(`${d.delta > 0 ? "+" : ""}${d.delta} ${unit} (now ${currentQty})`);
  if (d.qtyUnused !== undefined) parts.push(`unused → ${d.qtyUnused}`);
  if (d.qtyInUse !== undefined) parts.push(`in use → ${d.qtyInUse}`);
  if (d.qtyForRepair !== undefined) parts.push(`for repair → ${d.qtyForRepair}`);
  if (d.qtyDamaged !== undefined) parts.push(`damaged → ${d.qtyDamaged}`);
  if (d.newRequired !== undefined) parts.push(`new required → ${d.newRequired}`);
  if (d.threshold !== undefined) parts.push(`low-stock alert → ${d.threshold ?? "default"}`);
  if (d.owner !== undefined) parts.push(`owner → ${d.owner ?? "none"}`);
  const why = d.reason && d.reason !== "adjustment" ? ` · ${d.reason}` : "";
  const note = d.notes ? ` · "${d.notes}"` : "";
  return `${catalogName}: ${parts.join(", ") || "no quantity change"}${why}${note}`;
}
