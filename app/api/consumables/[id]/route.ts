// Edit / soft-delete a first-aid consumable. Permission: medicine.manage.
// DELETE is soft (active=false) so movement history keeps its FK.

import { NextRequest, NextResponse } from "next/server";
import { centreFence } from "@/lib/authz-centre";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { updateConsumableSchema } from "@/lib/schemas/consumable";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

async function loadOwned(id: string, session: { role: string; centreId: string | null; userId: string }) {
  const row = await prisma.consumable.findUnique({ where: { id } });
  if (!row) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  // isHQ alone let any organisation's HQ through; centreFence adds the org rule.
  const fence = await centreFence(session, row.centreId);
  if (fence) {
    return { error: NextResponse.json({ error: fence }, { status: 403 }) };
  }
  return { row };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "consumables");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "medicine.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { row, error } = await loadOwned(params.id, session);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = updateConsumableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  await prisma.consumable.update({
    where: { id: row!.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.unit !== undefined ? { unit: d.unit } : {}),
      ...(d.qty !== undefined ? { qty: d.qty } : {}),
      ...(d.reorderThreshold !== undefined ? { reorderThreshold: d.reorderThreshold } : {}),
      ...(d.supplier !== undefined ? { supplier: d.supplier } : {}),
      ...(d.storageLocation !== undefined ? { storageLocation: d.storageLocation } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    },
  });
  await audit({ userId: session.userId, action: "consumable.update", tableName: "consumable", rowId: row!.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "consumables");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "medicine.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { row, error } = await loadOwned(params.id, session);
  if (error) return error;

  await prisma.consumable.update({ where: { id: row!.id }, data: { active: false, deletedAt: new Date() } });
  await audit({ userId: session.userId, action: "consumable.deactivate", tableName: "consumable", rowId: row!.id });
  return NextResponse.json({ ok: true });
}
