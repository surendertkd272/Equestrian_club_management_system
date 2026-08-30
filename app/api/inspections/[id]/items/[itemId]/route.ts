// Mark an audit line pass / fail / na with remarks.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { markAuditItemSchema, CAN_INSPECT } from "@/lib/schemas/audit-run";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_INSPECT.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const item = await prisma.auditItem.findUnique({
    where: { id: params.itemId },
    include: { run: { select: { centreId: true } } },
  });
  if (!item || item.runId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  // isHQ alone let an HQ caller of ANY organisation through. centreFence
  // keeps the centre rule and adds the org rule HQ never had.
  const fence = await centreFence(session, item.run.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = markAuditItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.auditItem.update({
    where: { id: item.id },
    data: {
      result: parsed.data.result,
      remarks: parsed.data.remarks ?? null,
      // `undefined` leaves the stored count alone; an explicit null clears it.
      // Distinguishing the two matters: marking a line "pass" must not wipe
      // the number somebody just counted.
      ...(parsed.data.counted !== undefined ? { counted: parsed.data.counted } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "inspection.mark",
    tableName: "auditItem",
    rowId: item.id,
    after: { result: parsed.data.result },
  });

  return NextResponse.json({ ok: true });
}
