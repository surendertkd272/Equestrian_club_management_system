// Edit / soft-delete a vendor. Permission matches creation (expense.manage:
// SUPER_ADMIN, ADMIN, CENTRE_MANAGER, ACCOUNTANT). DELETE is soft (active=false)
// so historic expenses keep their vendor link.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateVendorSchema } from "@/lib/schemas/finance";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

async function loadOwned(id: string, session: { role: string; centreId: string | null }) {
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) return { error: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && vendor.centreId !== session.centreId) {
    return { error: NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 }) };
  }
  return { vendor };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "expense.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { vendor, error } = await loadOwned(params.id, session);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = updateVendorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  await prisma.vendor.update({
    where: { id: vendor!.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.deliveryScope !== undefined ? { deliveryScope: d.deliveryScope } : {}),
      ...(d.contactName !== undefined ? { contactName: d.contactName } : {}),
      ...(d.phone !== undefined ? { phone: d.phone } : {}),
      ...(d.email !== undefined ? { email: d.email } : {}),
      ...(d.address !== undefined ? { address: d.address } : {}),
      ...(d.gstin !== undefined ? { gstin: d.gstin } : {}),
      ...(d.bankAccountName !== undefined ? { bankAccountName: d.bankAccountName || null } : {}),
      ...(d.bankAccountNumber !== undefined ? { bankAccountNumber: d.bankAccountNumber || null } : {}),
      ...(d.bankIfsc !== undefined ? { bankIfsc: d.bankIfsc?.toUpperCase() || null } : {}),
      ...(d.bankName !== undefined ? { bankName: d.bankName || null } : {}),
      ...(d.upiId !== undefined ? { upiId: d.upiId || null } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      // Native Json column — pass the object straight through (no stringify).
      // Empty object → Prisma.DbNull so we don't leave "{}" rows behind.
      // (Plain `null` isn't accepted by Prisma for nullable Json columns —
      // it expects either Prisma.DbNull / Prisma.JsonNull or a real value.)
      ...(d.categorySpecific !== undefined
        ? {
            categorySpecificJson:
              d.categorySpecific && Object.keys(d.categorySpecific).length > 0
                ? (d.categorySpecific as Prisma.InputJsonValue)
                : Prisma.DbNull,
          }
        : {}),
    },
  });
  await audit({ userId: session.userId, action: "vendor.update", tableName: "vendor", rowId: vendor!.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "expense.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const { vendor, error } = await loadOwned(params.id, session);
  if (error) return error;

  await prisma.vendor.update({ where: { id: vendor!.id }, data: { active: false, deletedAt: new Date() } });
  await audit({ userId: session.userId, action: "vendor.deactivate", tableName: "vendor", rowId: vendor!.id });
  return NextResponse.json({ ok: true });
}
