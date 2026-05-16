import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { updateStockSchema } from "@/lib/schemas/equipment";
import { audit } from "@/lib/audit";
import { notifyLowStockIfCrossed } from "@/lib/equipment-notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// PATCH — set qty / apply delta / set threshold for a (centre, catalog
// item) pair. Auto-creates the EquipmentStock row on first touch. After
// the write, if the new qty crossed below the effective threshold AND
// we haven't already notified since the last restock, fire a low-stock
// notification to the centre's INVENTORY_MANAGER + every SUPER_ADMIN.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { catalogId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  // Inventory edits are limited to the inventory manager + centre manager
  // (and SUPER_ADMIN for cross-centre fixes). HEAD_COACH can adjust too —
  // they often handle quick stock checks during the day.
  if (
    !["SUPER_ADMIN", "CENTRE_MANAGER", "INVENTORY_MANAGER", "STABLE_MANAGER", "HEAD_COACH"].includes(session.role)
  ) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateStockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const url = new URL(req.url);
  const requested = url.searchParams.get("centreId");
  const centreId = requested && session.role === "SUPER_ADMIN" ? requested : scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const catalog = await prisma.equipmentCatalog.findUnique({ where: { id: params.catalogId } });
  if (!catalog) return NextResponse.json({ error: "CATALOG_NOT_FOUND" }, { status: 404 });

  const existing = await prisma.equipmentStock.findUnique({
    where: { centreId_catalogId: { centreId, catalogId: catalog.id } },
  });

  const previousQty = existing?.qty ?? 0;
  // Compute the new qty:
  //   - explicit qty wins
  //   - delta otherwise (clamped to >= 0)
  //   - else leave qty alone (threshold-only update)
  let newQty = previousQty;
  if (parsed.data.qty !== undefined) newQty = parsed.data.qty;
  else if (parsed.data.delta !== undefined) newQty = Math.max(0, previousQty + parsed.data.delta);

  const newThreshold =
    parsed.data.threshold === undefined ? existing?.threshold ?? null : parsed.data.threshold;

  // Restock = qty went UP. Resets the low-stock dedup so a future dip can
  // re-fire the notification.
  const isRestock = newQty > previousQty;

  const stock = await prisma.equipmentStock.upsert({
    where: { centreId_catalogId: { centreId, catalogId: catalog.id } },
    create: {
      centreId,
      catalogId: catalog.id,
      qty: newQty,
      threshold: newThreshold,
      lastRestockedAt: isRestock ? new Date() : null,
    },
    update: {
      qty: newQty,
      threshold: newThreshold,
      ...(isRestock ? { lastRestockedAt: new Date(), lastLowNotifiedAt: null } : {}),
    },
  });

  // Always record the movement, even threshold-only updates (delta=0). The
  // audit row helps reconstruct who set the threshold from what to what.
  if (parsed.data.qty !== undefined || parsed.data.delta !== undefined) {
    const delta = newQty - previousQty;
    await prisma.equipmentStockMovement.create({
      data: {
        stockId: stock.id,
        delta,
        reason: parsed.data.reason,
        notes: parsed.data.notes ?? null,
        actorId: session.userId,
      },
    });
  }

  await audit({
    userId: session.userId,
    action: "equipment_stock.update",
    tableName: "equipmentStock",
    rowId: stock.id,
    before: { qty: previousQty, threshold: existing?.threshold ?? null },
    after: { qty: newQty, threshold: newThreshold },
  });

  // Low-stock notification — fires at most once per dip cycle (resets when
  // qty goes back up).
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

  return NextResponse.json({ ok: true, qty: newQty, threshold: newThreshold ?? catalog.defaultThreshold });
}
