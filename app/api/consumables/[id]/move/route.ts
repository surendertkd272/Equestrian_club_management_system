import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { notifyCentreManager } from "@/lib/notify";
import { moveConsumableSchema } from "@/lib/schemas/consumable";

// POST /api/consumables/[id]/move — restock (in), use (out), or correct (adjust).
// Writes a ConsumableMovement audit row + updates the Consumable.qty atomically.
// When stock drops below the reorder threshold for the first time, the centre
// manager gets a one-time notification (the existing recentlyNotified gate
// prevents the same alert firing on every subsequent issue).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "consumables");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = moveConsumableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await prisma.consumable.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence84 = await centreFence(session, row.centreId);
  if (fence84) {
    return NextResponse.json({ error: fence84 }, { status: 403 });
  }

  // Resolve the new qty.
  let nextQty = row.qty;
  if (parsed.data.direction === "in") nextQty += parsed.data.qty;
  else if (parsed.data.direction === "out") {
    if (row.qty < parsed.data.qty) {
      return NextResponse.json({ error: "INSUFFICIENT_STOCK", available: row.qty }, { status: 409 });
    }
    nextQty -= parsed.data.qty;
  } else {
    // adjust = treat qty as the new absolute count
    nextQty = parsed.data.qty;
  }

  const [updated] = await prisma.$transaction([
    prisma.consumable.update({ where: { id: row.id }, data: { qty: nextQty } }),
    prisma.consumableMovement.create({
      data: {
        consumableId: row.id,
        direction: parsed.data.direction,
        qty: parsed.data.qty,
        reason: parsed.data.reason ?? null,
        byUserId: session.userId,
      },
    }),
  ]);

  await audit({
    userId: session.userId,
    action: `consumable.${parsed.data.direction}`,
    tableName: "consumable",
    rowId: row.id,
    before: { qty: row.qty },
    after: { qty: updated.qty, reason: parsed.data.reason },
  });

  // Just-crossed-threshold notification.
  if (row.qty > row.reorderThreshold && updated.qty <= updated.reorderThreshold) {
    await notifyCentreManager(row.centreId, {
      type: "consumable.low_stock",
      title: `Low stock · ${row.name}`,
      body: `Stock at ${updated.qty} ${row.unit}; reorder at ${row.reorderThreshold}.`,
      link: "/consumables",
      payload: { consumableId: row.id, qty: updated.qty, threshold: row.reorderThreshold },
    });
  }

  return NextResponse.json({
    ok: true,
    qty: updated.qty,
    lowStock: updated.qty <= updated.reorderThreshold,
  });
}
