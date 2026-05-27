// Recycle bin actions. POST { entity, id, action: "restore" | "purge" }.
//   restore — active=true, deletedAt=null (back to normal lists).
//   purge   — permanent hard-delete. Blocked (409) if the row is still
//             referenced by history (FK), so financial/medical records stay
//             intact; the admin clears dependents first.
// Permission: SUPER_ADMIN / ADMIN / CENTRE_MANAGER (catalog managers).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { canManageCatalog } from "@/lib/schemas/catalog";
import { isBinEntity, delegateFor, type BinEntity } from "@/lib/bin";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canManageCatalog(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const entity = body?.entity as string;
  const id = body?.id as string;
  const action = body?.action as string;
  if (!entity || !isBinEntity(entity) || !id || (action !== "restore" && action !== "purge")) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  const model = delegateFor(entity as BinEntity);
  const row = await model.findUnique({ where: { id }, select: { id: true, centreId: true, active: true } });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && row.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  if (action === "restore") {
    await model.update({ where: { id }, data: { active: true, deletedAt: null } });
    await audit({ userId: session.userId, action: `${entity}.restore`, tableName: entity, rowId: id });
    return NextResponse.json({ ok: true, restored: true });
  }

  // purge — try a hard delete; FK references (expenses, usages, movements,
  // members) make it fail, in which case the row stays in the bin.
  try {
    await model.delete({ where: { id } });
    await audit({ userId: session.userId, action: `${entity}.purge`, tableName: entity, rowId: id });
    return NextResponse.json({ ok: true, purged: true });
  } catch (e: any) {
    if (e?.code === "P2003" || e?.code === "P2014") {
      return NextResponse.json(
        { error: "STILL_REFERENCED", message: "This item is still linked to existing records and can't be permanently deleted. It will stay in the bin." },
        { status: 409 },
      );
    }
    throw e;
  }
}
