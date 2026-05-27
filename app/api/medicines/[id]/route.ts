// Edit / soft-delete a medicine. Permission: medicine.manage. DELETE is soft
// (active=false) so usage history + prescriptions keep their FK.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateMedicineSchema } from "@/lib/schemas/medicine";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

async function loadOwned(id: string, session: { role: string; centreId: string | null }) {
  const med = await prisma.medicine.findUnique({ where: { id } });
  if (!med) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && med.centreId !== session.centreId) {
    return { error: NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 }) };
  }
  return { med };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { med, error } = await loadOwned(params.id, session);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = updateMedicineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  await prisma.medicine.update({
    where: { id: med!.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.generic !== undefined ? { generic: d.generic } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.schedule !== undefined ? { schedule: d.schedule } : {}),
      ...(d.batchNo !== undefined ? { batchNo: d.batchNo } : {}),
      ...(d.mfgDate !== undefined ? { mfgDate: d.mfgDate ? new Date(d.mfgDate) : null } : {}),
      ...(d.expDate !== undefined ? { expDate: new Date(d.expDate) } : {}),
      ...(d.qty !== undefined ? { qty: d.qty } : {}),
      ...(d.reorderThreshold !== undefined ? { reorderThreshold: d.reorderThreshold } : {}),
      ...(d.supplier !== undefined ? { supplier: d.supplier } : {}),
      ...(d.storageLocation !== undefined ? { storageLocation: d.storageLocation } : {}),
      ...(d.coldChain !== undefined ? { coldChain: d.coldChain } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    },
  });
  await audit({ userId: session.userId, action: "medicine.update", tableName: "medicine", rowId: med!.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { med, error } = await loadOwned(params.id, session);
  if (error) return error;

  await prisma.medicine.update({ where: { id: med!.id }, data: { active: false } });
  await audit({ userId: session.userId, action: "medicine.deactivate", tableName: "medicine", rowId: med!.id });
  return NextResponse.json({ ok: true });
}
