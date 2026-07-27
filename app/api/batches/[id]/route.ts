// DELETE /api/batches/[id] — hard-delete a batch.
//
// Refuses if any rider is still assigned to the batch (FK on Rider.batchId)
// — the UI surfaces a 'reassign first' nudge for that case. Attendance and
// batch-shift-request rows are ON DELETE RESTRICT (not cascade), so a batch
// that carries attendance history or is referenced by a shift request can't
// be deleted even with zero current riders — we translate that FK violation
// into a clean 409 rather than letting it surface as a 500. Gated on
// batch.manage (the same permission as create); centre-scoped users can only
// delete their own centre's batches.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { updateBatchSchema } from "@/lib/schemas/batch";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "batch.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const batch = await prisma.batch.findUnique({
    where: { id: params.id },
    include: { _count: { select: { riders: true } } },
  });
  if (!batch) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Centre-scope guard. SUPER_ADMIN / ADMIN bypass; everyone else can only
  // delete their own centre's batches.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && batch.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Refuse if riders are still in this batch — the rider's batchId would
  // become a dangling reference. The UI checks this client-side too, but
  // the API is the real gate.
  if (batch._count.riders > 0) {
    return NextResponse.json(
      {
        error: "BATCH_HAS_RIDERS",
        message: `${batch._count.riders} rider${batch._count.riders === 1 ? "" : "s"} still assigned — reassign first.`,
        riderCount: batch._count.riders,
      },
      { status: 409 },
    );
  }

  try {
    await prisma.batch.delete({ where: { id: batch.id } });
  } catch (e: any) {
    // P2003 = FK violation. Attendance.batch and BatchShiftRequest.toBatch are
    // ON DELETE RESTRICT, so a batch with attendance history or a referencing
    // shift request can't be removed — return a clean 409 instead of a 500.
    if (e?.code === "P2003") {
      return NextResponse.json(
        {
          error: "BATCH_HAS_LINKED_RECORDS",
          message:
            "This batch has attendance history or shift requests linked to it and can't be deleted.",
        },
        { status: 409 },
      );
    }
    throw e;
  }
  await audit({
    userId: session.userId,
    action: "batch.delete",
    tableName: "batch",
    rowId: batch.id,
    before: { name: batch.name, centreId: batch.centreId, dayOfWeek: batch.dayOfWeek },
  });
  return NextResponse.json({ ok: true });
}

// PATCH /api/batches/[id] — edit a live batch.
//
// There was no update route: PATCH, PUT and POST all fell through to 405, so a
// class whose time shifted, whose coach changed or whose name was wrong could
// never be corrected — and DELETE refuses once it has riders, so the only
// option was to abandon it and create another. Same permission as create.
//
// Changing the time here deliberately does NOT retime already-scheduled
// Lesson rows: those are concrete sessions that may have horses allocated and
// attendance marked against them, and silently moving them would break both.
// The batch time is the template for FUTURE lessons; existing ones are edited
// individually on /lessons.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "batch.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = updateBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: parsed.error.issues[0]?.message, details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const batch = await prisma.batch.findUnique({ where: { id: params.id } });
  if (!batch) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles (SUPER_ADMIN, ADMIN) have centreId = null, so a bare
  // `row.centreId !== session.centreId` both LOCKS OUT the admin (every
  // comparison is true) and, where it exempts them, fences nothing at all.
  // Bind them to their own organisation instead.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (isHQ) {
    const [callerOrg, rowOrg] = await Promise.all([
      getOrgIdForSession(session),
      getOrgIdForCentre(batch.centreId),
    ]);
    if (!callerOrg || callerOrg !== rowOrg) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
  } else if (batch.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Merge over stored values before checking, so a one-sided edit can't invert
  // the window (same class of bug as the lesson and event date guards).
  const startTime = d.startTime ?? batch.startTime;
  const endTime = d.endTime ?? batch.endTime;
  if (endTime <= startTime) {
    return NextResponse.json(
      { error: "INVALID_TIME_RANGE", message: "End time must be after the start time." },
      { status: 400 },
    );
  }

  // A coach must exist, be active, and belong to this centre.
  if (d.coachId) {
    const coach = await prisma.user.findUnique({
      where: { id: d.coachId },
      select: { centreId: true, status: true, role: true, name: true },
    });
    // Same test POST /api/batches applies. Without the role check any active
    // account at the centre — a groom, the accountant, an inspection officer —
    // could be recorded as the batch's coach and would then be shown to
    // parents as the person teaching their child.
    if (
      !coach ||
      coach.status !== "active" ||
      coach.centreId !== batch.centreId ||
      (coach.role !== "COACH" && coach.role !== "HEAD_COACH")
    ) {
      return NextResponse.json(
        { error: "INVALID_COACH", message: "Pick an active coach at this centre." },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.batch.update({
    where: { id: batch.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.dayOfWeek !== undefined ? { dayOfWeek: d.dayOfWeek } : {}),
      ...(d.startTime !== undefined ? { startTime: d.startTime } : {}),
      ...(d.endTime !== undefined ? { endTime: d.endTime } : {}),
      ...(d.level !== undefined ? { level: d.level } : {}),
      ...(d.coachId !== undefined ? { coachId: d.coachId } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "batch.update",
    tableName: "batch",
    rowId: batch.id,
    before: { name: batch.name, dayOfWeek: batch.dayOfWeek, startTime: batch.startTime, endTime: batch.endTime, coachId: batch.coachId, level: batch.level },
    after: { name: updated.name, dayOfWeek: updated.dayOfWeek, startTime: updated.startTime, endTime: updated.endTime, coachId: updated.coachId, level: updated.level },
  });

  return NextResponse.json({ ok: true, batch: updated });
}
