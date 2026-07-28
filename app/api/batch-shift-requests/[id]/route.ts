// PATCH /api/batch-shift-requests/[id] — approve / reject a pending shift.
//
// Approver gates by kind:
//   single_day → COACH on target batch, HEAD_COACH, CENTRE_MANAGER, HQ admins
//   permanent  → HEAD_COACH, CENTRE_MANAGER, HQ admins (roster decision)
//
// Side-effects on approve:
//   single_day → create an Attendance row for {rider, toBatch, shiftDate}
//                with status='scheduled' so the target coach's roster
//                shows the visiting rider for that day.
//   permanent  → set rider.batchId = toBatchId (the new batch).
//
// Reject is no-op beyond audit + rider notification.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { notify } from "@/lib/notify";
import { decideBatchShiftSchema } from "@/lib/schemas/batch-shift";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = decideBatchShiftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await prisma.batchShiftRequest.findUnique({
    where: { id: params.id },
    include: {
      rider: { select: { id: true, userId: true, centreId: true, firstName: true } },
      toBatch: { select: { id: true, name: true, centreId: true, coachId: true } },
    },
  });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (row.status !== "pending") {
    return NextResponse.json({ error: "NOT_PENDING", current: row.status }, { status: 409 });
  }

  // Approver gate. Permanent shifts need HEAD_COACH / CENTRE_MANAGER /
  // HQ admin. Single-day allows the target batch's assigned coach too.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const isCentreSenior = (session.role === "CENTRE_MANAGER" || session.role === "HEAD_COACH")
    && session.centreId === row.toBatch.centreId;
  const isTargetCoach = row.kind === "single_day"
    && session.role === "COACH"
    && session.userId === row.toBatch.coachId;
  if (!isHQ && !isCentreSenior && !isTargetCoach) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  // isHQ short-circuits the two centre-aware conditions above, so without this
  // any tenant's HQ could approve any club's shift request by id — moving a
  // child between batches at a club they have nothing to do with.
  const fence = await centreFence(session, row.toBatch.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });

  if (parsed.data.decision === "reject") {
    await prisma.batchShiftRequest.update({
      where: { id: row.id },
      data: {
        status: "rejected",
        decidedByUserId: session.userId,
        decidedAt: new Date(),
        decisionNote: parsed.data.note ?? null,
      },
    });
    await audit({
      userId: session.userId,
      action: "batch_shift.reject",
      tableName: "batchShiftRequest",
      rowId: row.id,
      before: { status: "pending" },
      after: { status: "rejected", note: parsed.data.note ?? null },
    });
    if (row.rider.userId) {
      await notify({
        userId: row.rider.userId,
        centreId: row.rider.centreId,
        type: "batch_shift.rejected",
        title: `Batch shift request was declined`,
        body: parsed.data.note ?? `Your request to move to ${row.toBatch.name} was not approved.`,
        link: "/student",
      });
    }
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Approve.
  await prisma.$transaction(async (tx) => {
    await tx.batchShiftRequest.update({
      where: { id: row.id },
      data: {
        status: "approved",
        decidedByUserId: session.userId,
        decidedAt: new Date(),
        decisionNote: parsed.data.note ?? null,
      },
    });
    if (row.kind === "permanent") {
      await tx.rider.update({
        where: { id: row.riderId },
        data: { batchId: row.toBatchId },
      });
    } else if (row.kind === "single_day" && row.shiftDate) {
      // Idempotent: a duplicate-day attendance pre-record shouldn't block
      // the approval. Try-catch the unique violation (batchId, riderId, date).
      try {
        await tx.attendance.create({
          data: {
            batchId: row.toBatchId,
            riderId: row.riderId,
            date: row.shiftDate,
            status: "scheduled",
          },
        });
      } catch {
        // Already on the target batch's roster for that day — fine.
      }
    }
  });
  await audit({
    userId: session.userId,
    action: "batch_shift.approve",
    tableName: "batchShiftRequest",
    rowId: row.id,
    before: { status: "pending" },
    after: { status: "approved", kind: row.kind, toBatchId: row.toBatchId },
  });
  if (row.rider.userId) {
    await notify({
      userId: row.rider.userId,
      centreId: row.rider.centreId,
      type: "batch_shift.approved",
      title: `Batch shift approved`,
      body: row.kind === "permanent"
        ? `You're now in ${row.toBatch.name}.`
        : `Approved — you can attend ${row.toBatch.name} on the requested date.`,
      link: "/student",
    });
  }
  return NextResponse.json({ ok: true, status: "approved" });
}
