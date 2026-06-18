// Advance a trip's status: planned → departed → returned (or cancelled).
// Stamps returnAt when marked returned.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { updateTripStatusSchema, CAN_MANAGE_TRIPS } from "@/lib/schemas/venue-trip";

// Allowed status transitions — the trip exists to track inventory checked OUT
// before departure and IN on return, so reviving a cancelled/returned trip or
// skipping departure would break that evidence trail. Terminal: returned, cancelled.
const TRIP_NEXT: Record<string, string[]> = {
  planned: ["departed", "cancelled"],
  departed: ["returned", "cancelled"],
  returned: [],
  cancelled: [],
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_MANAGE_TRIPS.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const trip = await prisma.venueTrip.findUnique({ where: { id: params.id } });
  if (!trip) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.centreId !== trip.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateTripStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Reject illegal transitions (e.g. revive a cancelled trip, return without
  // departing). Same-status is a harmless no-op and allowed.
  if (parsed.data.status !== trip.status && !(TRIP_NEXT[trip.status] ?? []).includes(parsed.data.status)) {
    return NextResponse.json({ error: "ILLEGAL_TRANSITION", from: trip.status, to: parsed.data.status }, { status: 409 });
  }

  await prisma.venueTrip.update({
    where: { id: trip.id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.status === "returned" && !trip.returnAt ? { returnAt: new Date() } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "venue_trip.status",
    tableName: "venueTrip",
    rowId: trip.id,
    before: { status: trip.status },
    after: { status: parsed.data.status },
  });

  return NextResponse.json({ ok: true });
}
