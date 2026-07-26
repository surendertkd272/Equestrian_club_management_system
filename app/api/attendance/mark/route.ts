import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { markAttendanceSchema, parseDateOnly } from "@/lib/schemas/attendance";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { blockIfFeatureOff } from "@/lib/features-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "attendance");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "attendance.mark")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = markAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    // Surface the first field message. humanizeError() prefers an explicit
  // `message` over the generic code, so without this a coach who typed the
  // wrong year saw only "Some fields need fixing" with nothing highlighted.
  return NextResponse.json(
      { error: "VALIDATION", message: parsed.error.issues[0]?.message, details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { batchId, date, entries } = parsed.data;

  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "BATCH_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && batch.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Verify every rider belongs to this batch (or at least this centre).
  const riderIds = entries.map((e) => e.riderId);
  const riders = await prisma.rider.findMany({
    where: { id: { in: riderIds }, centreId: batch.centreId },
    select: { id: true, batchId: true },
  });
  if (riders.length !== riderIds.length) {
    return NextResponse.json({ error: "INVALID_RIDERS" }, { status: 400 });
  }

  const dateOnly = parseDateOnly(date);

  const ops = entries.map((e) =>
    prisma.attendance.upsert({
      where: { riderId_batchId_date: { riderId: e.riderId, batchId, date: dateOnly } },
      create: {
        riderId: e.riderId,
        batchId,
        date: dateOnly,
        status: e.status,
        reason: e.reason || null,
        markedBy: session.userId,
      },
      update: {
        status: e.status,
        reason: e.reason || null,
        markedBy: session.userId,
        markedAt: new Date(),
      },
    }),
  );

  await prisma.$transaction(ops);

  await audit({
    userId: session.userId,
    action: "attendance.mark",
    tableName: "attendance",
    rowId: `${batchId}:${date}`,
    after: { batchId, date, count: entries.length },
  });

  return NextResponse.json({ ok: true, count: entries.length });
}
