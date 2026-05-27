// Edit or delete a single checklist item. Editing is permissive (any
// field may be updated); deletion is soft (active=false) so historic
// submissions still resolve the FK. Permission: super_admin + admin.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { upsertItemSchema } from "@/lib/schemas/checklist";
import { blockIfReadOnly } from "@/lib/readonly-gate";

function canEditTemplate(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { templateId: string; itemId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canEditTemplate(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = upsertItemSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.checklistItem.findUnique({ where: { id: params.itemId } });
  if (!existing || existing.templateId !== params.templateId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const updated = await prisma.checklistItem.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.section !== undefined ? { section: parsed.data.section } : {}),
      ...(parsed.data.orderIndex !== undefined ? { orderIndex: parsed.data.orderIndex } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "checklist_item.update",
    tableName: "checklistItem",
    rowId: updated.id,
    before: { label: existing.label, active: existing.active },
    after: { label: updated.label, active: updated.active },
  });
  return NextResponse.json({ ok: true });
}

// Soft-delete — flip active to false so historic submissions still
// have a valid FK to read item label from.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { templateId: string; itemId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canEditTemplate(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const existing = await prisma.checklistItem.findUnique({ where: { id: params.itemId } });
  if (!existing || existing.templateId !== params.templateId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  await prisma.checklistItem.update({
    where: { id: existing.id },
    data: { active: false },
  });
  await audit({
    userId: session.userId,
    action: "checklist_item.deactivate",
    tableName: "checklistItem",
    rowId: existing.id,
  });
  return NextResponse.json({ ok: true });
}
