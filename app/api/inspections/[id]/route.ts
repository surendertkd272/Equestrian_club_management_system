// Complete an inspection run (stamp completedAt + optional summary).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { getOrgIdForSession } from "@/lib/features-gate";
import { completeAuditSchema, CAN_INSPECT } from "@/lib/schemas/audit-run";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_INSPECT.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const run = await prisma.auditRun.findUnique({
    where: { id: params.id },
    include: { centre: { select: { orgId: true } } },
  });
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Cross-org guard (defense-in-depth, mirrors the detail page at
  // app/(admin)/inspections/[id]/page.tsx). HQ users aren't pinned to a
  // centre, so without this an HQ operator could complete another org's run
  // by id if RLS were off. With RLS on, the findUnique already wouldn't return
  // a foreign-org row — this makes the guard explicit and flag-independent.
  const orgId = await getOrgIdForSession(session);
  if (!orgId || run.centre.orgId !== orgId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
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
