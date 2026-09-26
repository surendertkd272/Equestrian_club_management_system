import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentreForRoute } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { updateStockSchema } from "@/lib/schemas/equipment";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import type { Prisma } from "@prisma/client";
import { applyStockChange, describeStockChange } from "@/lib/equipment-stock";
import { CHANGE_KINDS, raiseChangeRequest, requiresApproval } from "@/lib/change-requests";

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
  // (and SUPER_ADMIN for cross-centre fixes). HEAD_COACH + COACH can still
  // PROPOSE an adjustment — they share ground-ops duties and are often the
  // ones who notice stock running out — but theirs goes to a manager for
  // approval instead of being written (below).
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

  // A coach's adjustment becomes a request a manager approves, rather than a
  // write — see lib/change-requests.ts. Nothing is written to the stock row
  // until then, so the count on screen stays the manager-approved one.
  if (requiresApproval(session.role)) {
    const current = await prisma.equipmentStock.findUnique({
      where: { centreId_catalogId: { centreId, catalogId: catalog.id } },
      select: { qty: true },
    });
    const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
    const request = await raiseChangeRequest({
      centreId,
      kind: CHANGE_KINDS.STOCK,
      entityId: catalog.id,
      title: `Stock change: ${catalog.name}`,
      body: describeStockChange(catalog.name, catalog.unit, current?.qty ?? 0, parsed.data),
      payload: { data: parsed.data } as Prisma.InputJsonValue,
      requestedBy: session.userId,
      requesterName: me?.name ?? "A coach",
    });
    return NextResponse.json(
      { ok: true, pending: true, approvalId: request.id, message: "Sent to a manager for approval." },
      { status: 202 },
    );
  }

  const r = await applyStockChange({ centreId, catalog, data: parsed.data, actorId: session.userId });
  return NextResponse.json({ ok: true, qty: r.newQty, threshold: r.threshold });
}
