// Add a new item to a checklist template. Edit / delete are handled
// per-item at /api/checklists/[templateId]/items/[itemId].
// Permission: super_admin + admin only (matches the catalog editor).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { upsertItemSchema } from "@/lib/schemas/checklist";
import { blockIfReadOnly } from "@/lib/readonly-gate";

function canEditTemplate(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export async function POST(req: NextRequest, { params }: { params: { templateId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canEditTemplate(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const tpl = await prisma.checklistTemplate.findUnique({
    where: { id: params.templateId },
    include: { items: { select: { orderIndex: true } } },
  });
  if (!tpl) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = upsertItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Default orderIndex = max + 1 so new items append.
  const maxOrder = tpl.items.length > 0 ? Math.max(...tpl.items.map((i) => i.orderIndex)) : -1;

  const item = await prisma.checklistItem.create({
    data: {
      templateId: tpl.id,
      label: parsed.data.label,
      section: parsed.data.section ?? null,
      orderIndex: parsed.data.orderIndex ?? maxOrder + 1,
      active: parsed.data.active ?? true,
    },
  });

  await audit({
    userId: session.userId,
    action: "checklist_item.create",
    tableName: "checklistItem",
    rowId: item.id,
    after: { templateId: tpl.id, label: item.label, section: item.section },
  });

  return NextResponse.json({ ok: true, item });
}
