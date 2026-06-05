import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { markStaffAttendanceSchema, composeDateTime } from "@/lib/schemas/staff-attendance";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Upsert a single staff member's attendance for a given day. (userId, date) is unique —
// re-submitting overwrites. Marker recorded in markedBy + auditLog.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "staff-attendance");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "staff.attendance")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = markStaffAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const staff = await prisma.user.findUnique({ where: { id: d.userId }, select: { id: true, centreId: true, role: true } });
  if (!staff) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  if (staff.role === "RIDER") {
    // Riders use the batch-based attendance flow, not staff attendance.
    return NextResponse.json({ error: "NOT_A_STAFF_USER" }, { status: 400 });
  }
  if (!staff.centreId) {
    return NextResponse.json({ error: "STAFF_HAS_NO_CENTRE" }, { status: 400 });
  }
  if (session.role !== "SUPER_ADMIN" && staff.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const dateOnly = parseDateOnly(d.date);
  const checkInAt = d.checkInAt ? composeDateTime(d.date, d.checkInAt) : null;
  const checkOutAt = d.checkOutAt ? composeDateTime(d.date, d.checkOutAt) : null;
  if (checkInAt && checkOutAt && checkOutAt < checkInAt) {
    return NextResponse.json({ error: "CHECKOUT_BEFORE_CHECKIN" }, { status: 400 });
  }

  const row = await prisma.staffAttendance.upsert({
    where: { userId_date: { userId: d.userId, date: dateOnly } },
    create: {
      userId: d.userId,
      centreId: staff.centreId,
      date: dateOnly,
      status: d.status,
      checkInAt,
      checkOutAt,
      overtimeHours: d.overtimeHours ?? null,
      notes: d.notes || null,
      markedBy: session.userId,
    },
    update: {
      status: d.status,
      checkInAt,
      checkOutAt,
      overtimeHours: d.overtimeHours ?? null,
      notes: d.notes || null,
      markedBy: session.userId,
      markedAt: new Date(),
    },
  });

  await audit({
    userId: session.userId,
    action: "staff_attendance.mark",
    tableName: "staffAttendance",
    rowId: row.id,
    after: { userId: d.userId, date: d.date, status: d.status, overtimeHours: d.overtimeHours ?? null },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
