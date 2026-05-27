// Check an item OUT (loading before departure) or IN (verifying on return),
// recording its condition. A "missing"/"damaged" condition on the IN pass is
// the loss/damage flag the client wanted. DELETE removes a manifest line.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { checkTripItemSchema, CAN_MANAGE_TRIPS } from "@/lib/schemas/venue-trip";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_MANAGE_TRIPS.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const item = await prisma.tripChecklistItem.findUnique({
    where: { id: params.itemId },
    include: { trip: { select: { centreId: true } } },
  });
  if (!item || item.tripId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== item.trip.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = checkTripItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const data: Record<string, unknown> =
    d.phase === "out"
      ? {
          checkedOut: d.checked,
          checkedOutAt: d.checked ? new Date() : null,
          conditionOut: d.condition ?? (d.checked ? "ok" : null),
        }
      : {
          checkedIn: d.checked,
          checkedInAt: d.checked ? new Date() : null,
          conditionIn: d.condition ?? (d.checked ? "ok" : null),
        };
  if (d.remarks !== undefined) data.remarks = d.remarks || null;

  const updated = await prisma.tripChecklistItem.update({ where: { id: item.id }, data });

  await audit({
    userId: session.userId,
    action: `venue_trip.check_${d.phase}`,
    tableName: "tripChecklistItem",
    rowId: item.id,
    after: { phase: d.phase, checked: d.checked, condition: d.condition ?? null },
  });

  return NextResponse.json({ ok: true, item: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_MANAGE_TRIPS.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const item = await prisma.tripChecklistItem.findUnique({
    where: { id: params.itemId },
    include: { trip: { select: { centreId: true } } },
  });
  if (!item || item.tripId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== item.trip.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  await prisma.tripChecklistItem.delete({ where: { id: item.id } });
  return NextResponse.json({ ok: true });
}
