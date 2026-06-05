import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { createBookingSchema } from "@/lib/schemas/facility-booking";

// GET — list upcoming bookings, optionally filtered by ?facilityId.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "facility-bookings");
  if (featureBlock) return featureBlock;

  const url = new URL(req.url);
  const facilityId = url.searchParams.get("facilityId");

  const where: Prisma.FacilityBookingWhereInput = {};
  if (session.role !== "SUPER_ADMIN" && session.centreId) where.centreId = session.centreId;
  if (facilityId) where.facilityId = facilityId;
  where.endAt = { gte: new Date(Date.now() - 24 * 86400000) }; // last 24h + upcoming

  const rows = await prisma.facilityBooking.findMany({
    where,
    orderBy: { startAt: "asc" },
    take: 200,
  });
  return NextResponse.json({ rows });
}

// POST — book a facility for [startAt, endAt). Refuses if an overlap exists
// with another booking on the same facility (the conflict window is half-open
// so back-to-back slots like 09:00→10:00 and 10:00→11:00 don't collide).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "facility-bookings");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const facility = await prisma.facility.findUnique({
    where: { id: d.facilityId },
    select: { id: true, centreId: true, name: true },
  });
  if (!facility) return NextResponse.json({ error: "FACILITY_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && facility.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const startAt = new Date(d.startAt);
  const endAt = new Date(d.endAt);
  if (!(startAt < endAt)) {
    return NextResponse.json({ error: "INVALID_TIME_RANGE" }, { status: 400 });
  }

  // Overlap detection: A.start < B.end AND A.end > B.start.
  const clash = await prisma.facilityBooking.findFirst({
    where: {
      facilityId: facility.id,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true, title: true, startAt: true, endAt: true },
  });
  if (clash) {
    return NextResponse.json(
      {
        error: "FACILITY_CONFLICT",
        details: {
          conflictWith: clash.title,
          start: clash.startAt,
          end: clash.endAt,
        },
      },
      { status: 409 },
    );
  }

  const row = await prisma.facilityBooking.create({
    data: {
      facilityId: facility.id,
      centreId: facility.centreId,
      purpose: d.purpose,
      refType: d.refType ?? null,
      refId: d.refId ?? null,
      title: d.title,
      startAt,
      endAt,
      createdBy: session.userId,
      notes: d.notes ?? null,
    },
  });

  await audit({
    userId: session.userId,
    action: "facility.book",
    tableName: "facilityBooking",
    rowId: row.id,
    after: { facilityId: facility.id, title: d.title, startAt, endAt },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
