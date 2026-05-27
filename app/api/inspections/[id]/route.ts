// Complete an inspection run (stamp completedAt + optional summary).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { completeAuditSchema, CAN_INSPECT } from "@/lib/schemas/audit-run";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_INSPECT.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const run = await prisma.auditRun.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== run.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = completeAuditSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.auditRun.update({
    where: { id: run.id },
    data: { status: "completed", completedAt: new Date(), summary: parsed.data.summary ?? run.summary },
  });

  await audit({
    userId: session.userId,
    action: "inspection.complete",
    tableName: "auditRun",
    rowId: run.id,
  });

  return NextResponse.json({ ok: true });
}
