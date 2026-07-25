// Create a venue transport trip. Permission: roles that run event logistics
// — admins, centre manager, head coach, stable manager (see CAN_MANAGE_TRIPS).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { scopeCentreForRoute } from "@/lib/tenancy";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createTripSchema, CAN_MANAGE_TRIPS } from "@/lib/schemas/venue-trip";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!CAN_MANAGE_TRIPS.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const scoped = scopeCentreForRoute(session);
  if (scoped.error) return scoped.error;
  const centreId = scoped.centreId;
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = createTripSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const trip = await prisma.venueTrip.create({
    data: {
      centreId,
      eventName: parsed.data.eventName,
      venue: parsed.data.venue,
      departureAt: new Date(parsed.data.departureAt),
      notes: parsed.data.notes ?? null,
      createdByUserId: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: "venue_trip.create",
    tableName: "venueTrip",
    rowId: trip.id,
    after: { eventName: trip.eventName, venue: trip.venue },
  });

  return NextResponse.json({ ok: true, id: trip.id });
}
