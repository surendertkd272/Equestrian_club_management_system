import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createUsageSchema, daysUntil } from "@/lib/schemas/medicine";
import { audit } from "@/lib/audit";
import { notifyCentreManager } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Thrown inside the usage transaction when the guarded decrement matches no
// row (stock raced below the requested qty) so the whole tx rolls back.
class MedicineOutOfStock extends Error {}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.prescribe")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createUsageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const medicine = await prisma.medicine.findUnique({ where: { id: params.id } });
  if (!medicine) return NextResponse.json({ error: "MEDICINE_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && medicine.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  if (daysUntil(medicine.expDate) < 0) {
    return NextResponse.json(
      { error: "EXPIRED", message: `${medicine.name} batch ${medicine.batchNo} is expired — cannot prescribe.` },
      { status: 409 },
    );
  }
  if (medicine.qty < d.qtyConsumed) {
    return NextResponse.json(
      { error: "OUT_OF_STOCK", message: `Only ${medicine.qty} available; tried to use ${d.qtyConsumed}.` },
      { status: 409 },
    );
  }

  const horse = await prisma.horse.findUnique({ where: { id: d.horseId } });
  if (!horse) return NextResponse.json({ error: "HORSE_NOT_FOUND" }, { status: 404 });
  if (horse.centreId !== medicine.centreId) {
    return NextResponse.json({ error: "HORSE_CROSS_CENTRE" }, { status: 400 });
  }

  const withdrawalUntil =
    d.withdrawalDays > 0 ? new Date(Date.now() + d.withdrawalDays * 86400000) : null;

  // Atomic, guarded decrement (C5a): the decrement is conditional on
  // qty >= qtyConsumed, so two concurrent uses of the last units can't both
  // pass the stale pre-check above and drive stock negative — the loser's
  // updateMany matches 0 rows and the whole transaction (usage insert + rest
  // flip) rolls back. Replaces the previous unconditional { decrement }.
  let usage: Awaited<ReturnType<typeof prisma.medicineUsage.create>>;
  let newQty: number;
  try {
    const r = await prisma.$transaction(async (tx) => {
      const dec = await tx.medicine.updateMany({
        where: { id: medicine.id, qty: { gte: d.qtyConsumed } },
        data: { qty: { decrement: d.qtyConsumed } },
      });
      if (dec.count === 0) throw new MedicineOutOfStock();
      const u = await tx.medicineUsage.create({
        data: {
          medicineId: medicine.id,
          horseId: horse.id,
          vetUserId: session.userId,
          dose: d.dose,
          route: d.route,
          reason: d.reason || null,
          withdrawalUntil,
        },
      });
      if (withdrawalUntil) {
        await tx.horse.update({ where: { id: horse.id }, data: { status: "rest" } });
      }
      const after = await tx.medicine.findUnique({ where: { id: medicine.id }, select: { qty: true } });
      return { usage: u, newQty: after!.qty };
    });
    usage = r.usage;
    newQty = r.newQty;
  } catch (e) {
    if (e instanceof MedicineOutOfStock) {
      return NextResponse.json(
        { error: "OUT_OF_STOCK", message: `Insufficient stock for ${medicine.name}.` },
        { status: 409 },
      );
    }
    throw e;
  }
  const horseStatusAfter = withdrawalUntil ? "rest" : horse.status;

  await audit({
    userId: session.userId,
    action: "medicine.prescribe",
    tableName: "medicineUsage",
    rowId: usage.id,
    after: {
      medicineId: medicine.id,
      medicineName: medicine.name,
      horseId: horse.id,
      horseName: horse.name,
      dose: d.dose,
      route: d.route,
      withdrawalUntil,
      newStockQty: newQty,
      horseStatusAfter,
    },
  });

  // Trigger notifications: withdrawal puts a horse on rest (alloc-blocking),
  // or a stock drop past the reorder threshold should reach the manager.
  if (withdrawalUntil) {
    await notifyCentreManager(medicine.centreId, {
      type: "medicine.withdrawal",
      title: `${horse.name} on rest until ${withdrawalUntil.toISOString().slice(0, 10)}`,
      body: `${medicine.name} prescribed (${d.dose} ${d.route.toUpperCase()}). Allocations blocked during withdrawal.`,
      link: `/horses/${horse.id}`,
      payload: { horseId: horse.id, medicineId: medicine.id, withdrawalUntil },
    });
  }
  if (newQty <= medicine.reorderThreshold && medicine.qty > medicine.reorderThreshold) {
    await notifyCentreManager(medicine.centreId, {
      type: "medicine.low_stock",
      title: `Low stock: ${medicine.name}`,
      body: `Stock dropped to ${newQty} (reorder at ${medicine.reorderThreshold}). Place a PO.`,
      link: `/medicines/${medicine.id}`,
      payload: { medicineId: medicine.id, qty: newQty },
    });
  }

  return NextResponse.json({
    id: usage.id,
    newQty,
    horseStatus: horseStatusAfter,
    withdrawalUntil,
    lowStock: newQty <= medicine.reorderThreshold,
  });
}
