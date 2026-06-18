import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { updateCatalogSchema } from "@/lib/schemas/equipment";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateCatalogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.equipmentCatalog.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const updated = await prisma.equipmentCatalog.update({ where: { id: params.id }, data: parsed.data });
  await audit({
    userId: session.userId,
    action: "equipment_catalog.update",
    tableName: "equipmentCatalog",
    rowId: updated.id,
    before: { defaultThreshold: before.defaultThreshold, active: before.active, name: before.name },
    after: { defaultThreshold: updated.defaultThreshold, active: updated.active, name: updated.name },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  // Soft archive — centres may still hold stock against this row and we
  // don't want to lose the audit trail.
  const row = await prisma.equipmentCatalog.update({
    where: { id: params.id },
    data: { active: false },
  });
  await audit({ userId: session.userId, action: "equipment_catalog.archive", tableName: "equipmentCatalog", rowId: row.id });
  return NextResponse.json({ ok: true });
}
