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
