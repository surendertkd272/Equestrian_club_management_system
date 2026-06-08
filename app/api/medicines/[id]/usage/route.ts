import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createUsageSchema, daysUntil } from "@/lib/schemas/medicine";
import { audit } from "@/lib/audit";
import { notifyCentreManager } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

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

  // Atomic: insert usage, decrement stock, optionally set horse to rest.
  const txOps = [
    prisma.medicineUsage.create({
      data: {
        medicineId: medicine.id,
        horseId: horse.id,
        vetUserId: session.userId,
        dose: d.dose,
        route: d.route,
        reason: d.reason || null,
        withdrawalUntil,
      },
    }),
    prisma.medicine.update({
      where: { id: medicine.id },
      data: { qty: { decrement: d.qtyConsumed } },
    }),
  ];
  if (withdrawalUntil) {
    txOps.push(prisma.horse.update({ where: { id: horse.id }, data: { status: "rest" } }) as any);
  }
  const results = await prisma.$transaction(txOps);
  const usage = results[0] as Awaited<ReturnType<typeof prisma.medicineUsage.create>>;
  const updatedMedicine = results[1] as Awaited<ReturnType<typeof prisma.medicine.update>>;
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
      newStockQty: updatedMedicine.qty,
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
  if (updatedMedicine.qty <= updatedMedicine.reorderThreshold && medicine.qty > medicine.reorderThreshold) {
    await notifyCentreManager(medicine.centreId, {
      type: "medicine.low_stock",
      title: `Low stock: ${medicine.name}`,
      body: `Stock dropped to ${updatedMedicine.qty} (reorder at ${updatedMedicine.reorderThreshold}). Place a PO.`,
      link: `/medicines/${medicine.id}`,
      payload: { medicineId: medicine.id, qty: updatedMedicine.qty },
    });
  }

  return NextResponse.json({
    id: usage.id,
    newQty: updatedMedicine.qty,
    horseStatus: horseStatusAfter,
    withdrawalUntil,
    lowStock: updatedMedicine.qty <= updatedMedicine.reorderThreshold,
  });
}
