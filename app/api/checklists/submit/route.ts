// Coach submits a daily checklist. One submission row + N item rows. The
// item label/section are snapshotted into ChecklistSubmissionItem so that
// rename/soft-delete of the template item doesn't rewrite history.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { submitChecklistSchema } from "@/lib/schemas/checklist";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Roles allowed to file a daily checklist — same crew that does morning
// rounds. (Admin tier included so HQ can submit on-site too.)
const CAN_SUBMIT = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
  "STABLE_MANAGER",
  "GROOM",
]);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_SUBMIT.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = submitChecklistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const tpl = await prisma.checklistTemplate.findUnique({
    where: { id: parsed.data.templateId },
    include: { items: true },
  });
  if (!tpl) return NextResponse.json({ error: "TEMPLATE_NOT_FOUND" }, { status: 404 });

  // Centre scope: HQ tier can submit on behalf of any centre; everyone
  // else must match their own.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== tpl.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Per-horse template requires a horseId; general one ignores it.
  if (tpl.scope === "per_horse" && !parsed.data.horseId) {
    return NextResponse.json({ error: "HORSE_REQUIRED" }, { status: 400 });
  }
  if (parsed.data.horseId) {
    const horse = await prisma.horse.findUnique({
      where: { id: parsed.data.horseId },
      select: { centreId: true },
    });
    if (!horse || horse.centreId !== tpl.centreId) {
      return NextResponse.json({ error: "HORSE_NOT_IN_CENTRE" }, { status: 400 });
    }
  }

  // Build a label snapshot map from the template items, rejecting any
  // submitted itemId that doesn't belong (or has been deactivated).
  const itemMap = new Map(tpl.items.filter((i) => i.active).map((i) => [i.id, i]));
  for (const r of parsed.data.items) {
    if (!itemMap.has(r.itemId)) {
      return NextResponse.json({ error: "INVALID_ITEM", itemId: r.itemId }, { status: 400 });
    }
  }

  const submission = await prisma.checklistSubmission.create({
    data: {
      templateId: tpl.id,
      centreId: tpl.centreId,
      submittedByUserId: session.userId,
      horseId: parsed.data.horseId ?? null,
      generalNotes: parsed.data.generalNotes ?? null,
      items: {
        create: parsed.data.items.map((r) => {
          const tplItem = itemMap.get(r.itemId)!;
          return {
            itemId: r.itemId,
            itemLabel: tplItem.label,
            itemSection: tplItem.section ?? null,
            status: r.status,
            remarks: r.remarks ?? null,
          };
        }),
      },
    },
  });

  await audit({
    userId: session.userId,
    action: "checklist.submit",
    tableName: "checklistSubmission",
    rowId: submission.id,
    after: {
      templateId: tpl.id,
      scope: tpl.scope,
      horseId: parsed.data.horseId ?? null,
      itemCount: parsed.data.items.length,
    },
  });

  return NextResponse.json({ ok: true, id: submission.id });
}
