// Rider-initiated batch shift requests.
//
//   POST  /api/batch-shift-requests   create a new request (rider role)
//   GET   /api/batch-shift-requests   list (rider sees own; admins see queue)
//
// Per-request decision lives at /api/batch-shift-requests/[id] with
// approve / reject actions.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { notifyMany } from "@/lib/notify";
import { createBatchShiftSchema } from "@/lib/schemas/batch-shift";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");

  // Rider role: only their own requests. Other roles: all centre-scoped
  // requests; SUPER_ADMIN sees every centre.
  if (session.role === "RIDER") {
    const rider = await prisma.rider.findFirst({ where: { userId: session.userId } });
    if (!rider) return NextResponse.json({ requests: [] });
    const requests = await prisma.batchShiftRequest.findMany({
      where: { riderId: rider.id, ...(statusFilter ? { status: statusFilter } : {}) },
      include: { toBatch: { select: { name: true } }, fromBatch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ requests });
  }

  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const requests = await prisma.batchShiftRequest.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(isHQ
        ? {}
        : session.centreId
          ? { toBatch: { centreId: session.centreId } }
          : { id: "no-match" }),
    },
    include: {
      rider: { select: { id: true, firstName: true, lastName: true, centreId: true } },
      toBatch: { select: { id: true, name: true, centreId: true } },
      fromBatch: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ requests });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "RIDER") {
    return NextResponse.json({ error: "FORBIDDEN", message: "Only riders can submit shift requests." }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createBatchShiftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const rider = await prisma.rider.findFirst({ where: { userId: session.userId } });
  if (!rider) return NextResponse.json({ error: "NO_RIDER_LINK" }, { status: 404 });

  // Target batch must exist + belong to the same centre as the rider —
  // we don't allow cross-centre shifts via this flow.
  const toBatch = await prisma.batch.findUnique({
    where: { id: d.toBatchId },
    select: { id: true, centreId: true, name: true, coachId: true },
  });
  if (!toBatch) return NextResponse.json({ error: "TARGET_BATCH_NOT_FOUND" }, { status: 404 });
  if (toBatch.centreId !== rider.centreId) {
    return NextResponse.json({ error: "CROSS_CENTRE_SHIFT_NOT_ALLOWED" }, { status: 400 });
  }

  // Don't allow a request to the rider's CURRENT batch.
  if (rider.batchId === d.toBatchId) {
    return NextResponse.json({ error: "ALREADY_IN_TARGET" }, { status: 400 });
  }

  const row = await prisma.batchShiftRequest.create({
    data: {
      riderId: rider.id,
      kind: d.kind,
      fromBatchId: rider.batchId,
      toBatchId: d.toBatchId,
      shiftDate: d.kind === "single_day" && d.shiftDate ? new Date(`${d.shiftDate}T00:00:00`) : null,
      effectiveFrom: d.effectiveFrom ? new Date(`${d.effectiveFrom}T00:00:00`) : null,
      reason: d.reason ?? null,
      status: "pending",
    },
  });
  await audit({
    userId: session.userId,
    action: "batch_shift.create",
    tableName: "batchShiftRequest",
    rowId: row.id,
    after: { kind: row.kind, toBatchId: row.toBatchId, shiftDate: row.shiftDate },
  });

  // Notify the right approver pool. Single-day: target batch's coach +
  // centre manager. Permanent: centre manager only (roster decision).
  const approverIds = await prisma.user.findMany({
    where: {
      centreId: rider.centreId,
      status: "active",
      role: d.kind === "permanent"
        ? { in: ["CENTRE_MANAGER", "HEAD_COACH"] }
        : { in: ["CENTRE_MANAGER", "HEAD_COACH", "COACH"] },
    },
    select: { id: true },
  });
  await notifyMany(approverIds.map((u) => u.id), {
    centreId: rider.centreId,
    type: "batch_shift.requested",
    title: `Batch shift request from ${rider.firstName} ${rider.lastName}`,
    body: d.kind === "single_day"
      ? `Wants to attend ${toBatch.name} on ${d.shiftDate}. Review in /batch-shifts.`
      : `Wants to permanently move to ${toBatch.name}. Review in /batch-shifts.`,
    link: "/batch-shifts",
    payload: { batchShiftRequestId: row.id, riderId: rider.id },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
