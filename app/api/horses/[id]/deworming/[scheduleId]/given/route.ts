// Mark a scheduled deworming dose as administered. Stamps givenAt +
// givenByUserId on the row and (optionally) seeds the next dose so the
// rotation continues without manual data-entry.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { markGivenSchema } from "@/lib/schemas/deworming";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; scheduleId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "medicine.manage") && !can(session.role, "horse.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const row = await prisma.dewormingSchedule.findUnique({
    where: { id: params.scheduleId },
    include: { horse: { select: { centreId: true } } },
  });
  if (!row || row.horseId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  // isHQ alone let an HQ caller of ANY organisation through. centreFence
  // keeps the centre rule and adds the org rule HQ never had.
  const fence = await centreFence(session, row.horse.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = markGivenSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const givenAt = parsed.data.givenAt ? new Date(parsed.data.givenAt) : new Date();
  const nextDueAt = new Date(givenAt.getTime() + parsed.data.nextIntervalDays * 86400000);

  await prisma.dewormingSchedule.update({
    where: { id: row.id },
    data: {
      givenAt,
      givenByUserId: session.userId,
      nextDueAt,
      notes: parsed.data.notes ?? row.notes,
    },
  });

  await audit({
    userId: session.userId,
    action: "deworming.given",
    tableName: "dewormingSchedule",
    rowId: row.id,
    before: { givenAt: row.givenAt },
    after: { givenAt, nextDueAt },
  });

  return NextResponse.json({ ok: true, nextDueAt });
}
