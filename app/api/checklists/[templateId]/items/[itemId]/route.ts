// Edit or delete a single checklist item. Editing is permissive (any
// field may be updated). Deletion is a genuine hard delete when nothing
// references the item; it only falls back to soft (active=false) when past
// submissions hold the FK, so historic readouts stay intact. Permission:
// super_admin + admin.

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

// Hard-delete when no submissions reference the item; refuse with 409
// otherwise. ChecklistSubmissionItem already snapshots itemLabel at
// submit time, so a hard delete doesn't break historic submission
// readouts — they keep showing the original label.
//
// 'Remove' meaning hard-delete (not deactivate) is what the user expects
// per the QA report — deactivating items quietly was confusing because
// the items still showed up in admin templates with grey styling.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { templateId: string; itemId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canEditTemplate(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const existing = await prisma.checklistItem.findUnique({ where: { id: params.itemId } });
  if (!existing || existing.templateId !== params.templateId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // FK guard. If any ChecklistSubmissionItem references this item, hard
  // delete would fail at the DB layer — surface that cleanly with a
  // soft-delete suggestion. Most active templates will have submissions.
  const referenceCount = await prisma.checklistSubmissionItem.count({
    where: { itemId: existing.id },
  });
  if (referenceCount > 0) {
    // Auto-fallback: deactivate when delete would break the FK. Spares
    // the admin from a confusing 409 — the item disappears from active
    // templates either way; the only difference is historic readouts.
    await prisma.checklistItem.update({
      where: { id: existing.id },
      data: { active: false },
    });
    await audit({
      userId: session.userId,
      action: "checklist_item.deactivate",
      tableName: "checklistItem",
      rowId: existing.id,
      after: { reason: "has_submissions", count: referenceCount },
    });
    return NextResponse.json({
      ok: true,
      mode: "deactivated",
      message: `Item kept as inactive — ${referenceCount} past submission${referenceCount === 1 ? "" : "s"} reference it. The item is hidden from active templates.`,
    });
  }

  // No history → genuine hard delete.
  await prisma.checklistItem.delete({ where: { id: existing.id } });
  await audit({
    userId: session.userId,
    action: "checklist_item.delete",
    tableName: "checklistItem",
    rowId: existing.id,
    before: { label: existing.label, templateId: existing.templateId },
  });
  return NextResponse.json({ ok: true, mode: "deleted" });
}
