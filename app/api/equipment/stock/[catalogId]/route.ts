import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentreForRoute } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
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
  // (and SUPER_ADMIN for cross-centre fixes). HEAD_COACH + COACH can adjust
  // too — coaches share ground-ops duties and cover for each other, so
  // inventory access is deliberately not siloed to one person.
  if (
    !["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "INVENTORY_MANAGER", "STABLE_MANAGER", "HEAD_COACH", "COACH"].includes(session.role)
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
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const fromParam = requested && isHQ;
  const scoped = scopeCentreForRoute(session);
  if (scoped.error) return scoped.error;
  const centreId = fromParam ? requested : scoped.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  // Cross-org guard (C1): an HQ user targeting a centre by ?centreId= must not
  // be able to write into a centre outside their own Organisation. scopeCentre
  // already pins centre-scoped roles to their own (in-org) centre, so only the
  // param-driven HQ path can target a foreign centre. The composite-key upsert
  // and the raw FOR UPDATE below act on this centreId directly, so validate it
  // explicitly here (tenantWhere can't guard a write-by-key).
  if (fromParam) {
    const callerOrgId = await getOrgIdForSession(session);
    if (!callerOrgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });
    const targetOrgId = await getOrgIdForCentre(centreId);
    if (!targetOrgId || targetOrgId !== callerOrgId) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
  }

  const catalog = await prisma.equipmentCatalog.findUnique({ where: { id: params.catalogId } });
  if (!catalog) return NextResponse.json({ error: "CATALOG_NOT_FOUND" }, { status: 404 });

  // H2 — serialize concurrent adjustments for this (centre, catalog) pair.
  // The whole read → compute → upsert → movement runs inside a transaction
  // that first takes SELECT … FOR UPDATE on the stock row, so two delta writes
  // can't both read the same prev value and lose an update (and the audited
  // movement delta is computed from the locked prev, not a stale read). A
  // first-touch double-create (no row to lock yet) raises P2002 and is retried
  // once — by then the row exists and takes the locked update path.
  let stock: Awaited<ReturnType<typeof prisma.equipmentStock.upsert>>;
  let newQty = 0;
  let newThreshold: number | null = null;
  let previousQty = 0;
  let beforeThreshold: number | null = null;

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

      let newUnused = parsed.data.qtyUnused ?? prevUnused;
      const newInUse = parsed.data.qtyInUse ?? prevInUse;
      const newForRepair = parsed.data.qtyForRepair ?? prevForRepair;
      const newDamaged = parsed.data.qtyDamaged ?? prevDamaged;
      // Legacy qty/delta path → treated as qtyUnused so the row stays correct.
      if (parsed.data.qty !== undefined) {
        newUnused = parsed.data.qty;
      } else if (parsed.data.delta !== undefined) {
        newUnused = Math.max(0, prevUnused + parsed.data.delta);
      }
      newQty = newUnused + newInUse; // cached "available" for the low-stock sweep
      newThreshold = parsed.data.threshold === undefined ? existing?.threshold ?? null : parsed.data.threshold;
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
          newRequired: parsed.data.newRequired ?? 0,
          owner: parsed.data.owner ?? null,
          notes: parsed.data.notes ?? null,
          threshold: newThreshold,
          lastRestockedAt: isRestock ? new Date() : null,
        },
        update: {
          qty: newQty,
          qtyUnused: newUnused,
          qtyInUse: newInUse,
          qtyForRepair: newForRepair,
          qtyDamaged: newDamaged,
          ...(parsed.data.newRequired !== undefined ? { newRequired: parsed.data.newRequired } : {}),
          ...(parsed.data.owner !== undefined ? { owner: parsed.data.owner } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
          threshold: newThreshold,
          ...(isRestock ? { lastRestockedAt: new Date(), lastLowNotifiedAt: null } : {}),
        },
      });

      // Always record the movement, even threshold-only updates (delta=0).
      if (parsed.data.qty !== undefined || parsed.data.delta !== undefined) {
        await tx.equipmentStockMovement.create({
          data: {
            stockId: s.id,
            delta: newQty - previousQty,
            reason: parsed.data.reason,
            notes: parsed.data.notes ?? null,
            actorId: session.userId,
          },
        });
      }
      return s;
    });

  try {
    stock = await runTx();
  } catch (e: any) {
    if (e?.code === "P2002") {
      stock = await runTx();
    } else {
      throw e;
    }
  }

  await audit({
    userId: session.userId,
    action: "equipment_stock.update",
    tableName: "equipmentStock",
    rowId: stock.id,
    before: { qty: previousQty, threshold: beforeThreshold },
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
