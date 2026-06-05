import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { createLeaveRequestSchema, LEAVE_STATUSES } from "@/lib/schemas/leave-request";
import { audit } from "@/lib/audit";
import { notifyRole } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// POST — submit a leave request for the signed-in user. Anyone with leave.request
// permission can submit (i.e. all staff roles). Riders are intentionally excluded.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "leave-requests");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "leave.request")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  if (!session.centreId) {
    return NextResponse.json({ error: "USER_HAS_NO_CENTRE" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createLeaveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const row = await prisma.leaveRequest.create({
    data: {
      userId: session.userId,
      centreId: session.centreId,
      startDate: new Date(`${d.startDate}T00:00:00.000Z`),
      endDate: new Date(`${d.endDate}T23:59:59.999Z`),
      reason: d.reason,
    },
  });

  await audit({
    userId: session.userId,
    action: "leave.request",
    tableName: "leaveRequest",
    rowId: row.id,
    after: { startDate: d.startDate, endDate: d.endDate, reason: d.reason },
  });

  // Heads-up to anyone who can approve in this centre.
  await notifyRole("CENTRE_MANAGER", {
    centreId: session.centreId,
    type: "leave.requested",
    title: `Leave request from ${session.name}`,
    body: `${d.startDate} → ${d.endDate} · ${d.reason}`,
    link: `/leave-requests`,
    payload: { leaveRequestId: row.id, requesterId: session.userId },
  });

  return NextResponse.json({ ok: true, id: row.id });
}

// GET — list requests in the caller's centre. Filter by status / userId if provided.
// Staff without leave.approve only see their own rows.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "leave-requests");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "leave.request") && !can(session.role, "leave.approve")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const requestedCentre = url.searchParams.get("centre");
  const scopedCentre = scopeCentre(session, requestedCentre);

  const where: Record<string, unknown> = { ...centreWhere(scopedCentre) };
  if (status && (LEAVE_STATUSES as readonly string[]).includes(status)) {
    where.status = status;
  }
  // Approvers see all; everyone else only their own.
  if (!can(session.role, "leave.approve")) {
    where.userId = session.userId;
  }

  const rows = await prisma.leaveRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    include: { user: { select: { id: true, name: true, role: true } } },
    take: 200,
  });

  return NextResponse.json({ rows });
}
