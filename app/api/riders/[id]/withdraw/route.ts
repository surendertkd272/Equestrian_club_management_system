// Off-board a rider — the family has left the club.
//
// Until now there was no way to say this. A rider who stopped coming stayed
// "active" for ever: on the coach's roster every morning, in the centre's
// headcount, in the fee-reminder sweep. The workarounds seen in the field were
// all bad — renaming the child "LEFT — Ananya", deleting the record (taking
// three years of attendance and their certificates with it), or just letting
// the roster rot until nobody trusted it.
//
// Three things a real off-boarding has to settle, all handled here:
//   1. The roster — status moves to "withdrawn", which is outside
//      ENROLLED_RIDER_STATUSES, so the rider drops off attendance and lesson
//      pickers immediately, and the batch seat is freed for someone else.
//   2. The money — what they still owe is stated back to the operator, who
//      decides: cancel it (credit notes, the mid-term-withdrawal case) or keep
//      chasing it (they owe for lessons they took). Never guessed at.
//   3. The record — nothing is deleted. Attendance, invoices, certificates and
//      exam history stay exactly where they are, and the rider can be brought
//      back with POST .../withdraw?undo (see the DELETE handler below) if they
//      return next season, or if this was recorded against the wrong child.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { blockIfFeatureOff, getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { creditPosition, writeCreditNote, lockAndLoadInvoice } from "@/lib/credit-note";
import { notifyRiderAndParents } from "@/lib/notify";

const schema = z.object({
  reason: z.string().min(3).max(300),
  // The rider's actual last day, which is usually not today. Accepts a plain
  // date (YYYY-MM-DD) from the form or a full ISO timestamp.
  lastDayAt: z.string().min(8).max(40).optional(),
  // Cancel what is still owed by issuing a credit note against each unpaid
  // invoice. Defaults to false: a club is entitled to chase fees for lessons
  // already taken, and quietly writing them off would be the wrong default.
  cancelOutstanding: z.boolean().optional().default(false),
  // Free the batch seat. On by default — that is the point of off-boarding.
  clearBatch: z.boolean().optional().default(true),
});

/** Same org/centre fence the rider PATCH route applies. */
async function assertReachable(
  session: { role: string; centreId: string | null },
  riderCentreId: string,
): Promise<string | null> {
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (isHQ) {
    const [callerOrg, rowOrg] = await Promise.all([
      getOrgIdForSession(session as Parameters<typeof getOrgIdForSession>[0]),
      getOrgIdForCentre(riderCentreId),
    ]);
    if (!callerOrg || callerOrg !== rowOrg) return "FORBIDDEN_CROSS_ORG";
  } else if (riderCentreId !== session.centreId) {
    return "FORBIDDEN_CROSS_CENTRE";
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "rider.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "Say why the rider is leaving.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // Taking a child off the roster is a rider.write action; writing off what
  // their family owes is not. Without this a HEAD_COACH — who holds rider.write
  // but not finance.write, and is refused outright by the manual credit-note
  // route — could cancel a family's whole balance from the off-board dialog.
  if (d.cancelOutstanding) {
    if (!can(session.role, "finance.write")) {
      return NextResponse.json(
        {
          error: "CANNOT_CANCEL_DUES",
          message: "You can off-board this rider, but only finance staff can cancel what the family owes.",
        },
        { status: 403 },
      );
    }
    const featureBlock = await blockIfFeatureOff(session, "fee-collection");
    if (featureBlock) return featureBlock;
  }

  const rider = await prisma.rider.findUnique({
    where: { id: params.id },
    include: {
      centre: { select: { name: true } },
      invoices: {
        where: { voidedAt: null, creditNoteForId: null },
        select: {
          id: true,
          centreId: true,
          riderId: true,
          amount: true,
          gstAmount: true,
          status: true,
          payments: { select: { amount: true } },
          creditNotes: { select: { amount: true, gstAmount: true } },
        },
      },
    },
  });
  if (!rider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await assertReachable(session, rider.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  if (rider.status === "withdrawn") {
    return NextResponse.json(
      { error: "ALREADY_WITHDRAWN", withdrawnAt: rider.withdrawnAt },
      { status: 409 },
    );
  }

  // A date-only string means a calendar day, not midnight UTC — but the only
  // thing this feeds is a "last day" display, so keep it simple and let the
  // Date constructor take it. An empty/garbled value is rejected rather than
  // silently stored as Invalid Date.
  let lastDayAt: Date | null = null;
  if (d.lastDayAt) {
    const parsedDate = new Date(d.lastDayAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: "VALIDATION", message: "Last day isn't a valid date." }, { status: 400 });
    }
    lastDayAt = parsedDate;
  }

  let outstandingBefore = 0;
  let releasedAllocations: { id: string; horseId: string; startAt: string; purpose: string }[] = [];
  const cancelled: { invoiceId: string; amount: number; creditNoteId: string }[] = [];
  // The ALREADY_WITHDRAWN guard is the idempotency defence for exactly the case
  // that breaks it — an operator resubmitting a slow request. Re-check it and
  // credit each invoice under that invoice's row lock, or two overlapping calls
  // each issue a full set of credit notes and the family's ledger goes
  // permanently negative.
  // Display/audit figure, computed from the pre-read. The authoritative
  // per-invoice number is recomputed under each invoice's lock below.
  outstandingBefore = rider.invoices.reduce((t, inv) => t + creditPosition(inv).outstanding, 0);

  const raced = await prisma.$transaction(
    async (tx) => {
      // Claim the rider with a CONDITIONAL update instead of a read + a lock.
      // It is atomic, it tells us who won (count === 0 means someone else
      // withdrew this rider first), and it avoids holding a separate explicit
      // row lock — a plain `SELECT ... FOR UPDATE` on Rider followed by locks
      // on their Invoices takes Rider→Invoice, while the Razorpay webhook
      // takes Invoice→Rider, which is a textbook ABBA deadlock under load.
      const claimed = await tx.rider.updateMany({
        where: { id: rider.id, status: { not: "withdrawn" } },
        data: {
          status: "withdrawn",
          withdrawnAt: new Date(),
          withdrawnByUserId: session.userId,
          withdrawalReason: d.reason,
          lastDayAt,
          // Remember where to put them back. Deriving the restored status from
          // registrationPaid silently APPROVED an applicant who was withdrawn
          // while pending_approval, and demoted a paid-up rider whose club
          // collects fees offline.
          statusBeforeWithdrawal: rider.status,
          ...(d.clearBatch ? { batchId: null } : {}),
        },
      });
      if (claimed.count === 0) return true;

      // A departed child must not stay booked on a horse. Their allocations on
      // sessions that have not happened yet are released, so the horse is free
      // and the yard sheet stops listing a rider who has left. Past
      // allocations are history and stay exactly as they are.
      // Record what was released before releasing it — otherwise a horse simply
      // becomes free and nothing says why, or which sessions were affected.
      const freed = await tx.horseAllocation.findMany({
        where: { riderId: rider.id, startAt: { gte: new Date() } },
        select: { id: true, horseId: true, startAt: true, purpose: true },
      });
      releasedAllocations = freed.map((a) => ({
        id: a.id,
        horseId: a.horseId,
        startAt: a.startAt.toISOString(),
        purpose: a.purpose,
      }));
      await tx.horseAllocation.deleteMany({
        where: { riderId: rider.id, startAt: { gte: new Date() } },
      });

      // Only touch invoices when there is actually money to cancel — a plain
      // roster removal shouldn't lock every invoice a family has ever had.
      if (d.cancelOutstanding) {
        // Deterministic order, so two concurrent writers can't take the same
        // two invoice locks in opposite orders.
        const ordered = [...rider.invoices].sort((a, b) => (a.id < b.id ? -1 : 1));
        for (const stale of ordered) {
          const inv = await lockAndLoadInvoice(tx, stale.id);
          if (!inv || inv.voidedAt || inv.creditNoteForId) continue;
          const position = creditPosition(inv);
          if (position.outstanding <= 0.001) continue;
          const note = await writeCreditNote(tx, inv, position, position.outstanding);
          cancelled.push({ invoiceId: inv.id, amount: position.outstanding, creditNoteId: note.id });
        }
      }
      return false;
    },
    // Crediting a long-standing family's whole history can exceed the 5s default.
    { timeout: 20_000 },
  );

  if (raced) {
    return NextResponse.json(
      { error: "ALREADY_WITHDRAWN", message: "This rider was already off-boarded." },
      { status: 409 },
    );
  }

  const cancelledTotal = cancelled.reduce((t, c) => t + c.amount, 0);

  await audit({
    userId: session.userId,
    action: "rider.withdraw",
    tableName: "rider",
    rowId: rider.id,
    before: { status: rider.status, batchId: rider.batchId },
    after: {
      status: "withdrawn",
      reason: d.reason,
      lastDayAt,
      batchCleared: d.clearBatch,
      outstandingAtWithdrawal: outstandingBefore,
      horseAllocationsReleased: releasedAllocations,
      duesCancelled: cancelledTotal,
      creditNotesIssued: cancelled.length,
    },
  });

  // One audit row per credit note, in the same shape the manual credit-note
  // route writes. Without these, money cancelled through off-boarding was
  // invisible to anyone auditing an individual invoice.
  for (const c of cancelled) {
    await audit({
      userId: session.userId,
      action: "invoice.credit_note",
      tableName: "invoice",
      rowId: c.creditNoteId,
      after: {
        creditNoteFor: c.invoiceId,
        amount: -c.amount,
        reason: `Rider off-boarded: ${d.reason}`,
        riderId: rider.id,
      },
    });
  }

  // Tell the family it's done, and what happened to the money. Silence here is
  // how disputes start ("nobody told us we still owed ₹6,000").
  await notifyRiderAndParents(rider.id, {
    type: "rider.withdrawn",
    title: `Enrolment closed at ${rider.centre.name}`,
    body:
      cancelledTotal > 0.001
        ? `${rider.firstName}'s enrolment has been closed and the outstanding balance of ₹${Math.round(cancelledTotal).toLocaleString("en-IN")} has been cancelled. Records and certificates stay available in your account.`
        : outstandingBefore > 0.001
          ? `${rider.firstName}'s enrolment has been closed. ₹${Math.round(outstandingBefore).toLocaleString("en-IN")} remains outstanding — please contact the centre to settle it.`
          : `${rider.firstName}'s enrolment has been closed with nothing outstanding. Records and certificates stay available in your account.`,
    link: `/parent`,
  });

  return NextResponse.json({
    ok: true,
    status: "withdrawn",
    outstandingBefore,
    duesCancelled: cancelledTotal,
    creditNotesIssued: cancelled.length,
    // What is still owed after whatever was cancelled — the number the
    // operator has to act on.
    outstandingAfter: outstandingBefore - cancelledTotal,
  });
}

// DELETE /api/riders/[id]/withdraw — bring a rider back.
//
// Families return, and off-boarding gets recorded against the wrong child.
// Re-activating restores the previous status rather than assuming "active":
// someone withdrawn while still awaiting their registration payment goes back
// to pending_payment, not straight to a paid-up member.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "rider.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const rider = await prisma.rider.findUnique({ where: { id: params.id } });
  if (!rider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await assertReachable(session, rider.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });
  if (rider.status !== "withdrawn") {
    return NextResponse.json(
      { error: "NOT_WITHDRAWN", message: "This rider isn't withdrawn.", status: rider.status },
      { status: 409 },
    );
  }

  // Put them back exactly where they were. The first version derived this from
  // registrationPaid, which was wrong twice over: an applicant withdrawn while
  // pending_approval came back "pending_payment" — silently approved, and out
  // of the approval queue for ever — and a paid-up rider at a club that
  // collects fees offline (registrationPaid = false) was demoted out of the
  // active roster. statusBeforeWithdrawal records the truth at withdrawal time;
  // older rows written before that column existed fall back to the old rule.
  const restored =
    rider.statusBeforeWithdrawal ?? (rider.registrationPaid ? "active" : "pending_payment");
  await prisma.rider.update({
    where: { id: rider.id },
    data: {
      status: restored,
      withdrawnAt: null,
      withdrawnByUserId: null,
      withdrawalReason: null,
      lastDayAt: null,
      statusBeforeWithdrawal: null,
    },
  });

  await audit({
    userId: session.userId,
    action: "rider.rejoin",
    tableName: "rider",
    rowId: rider.id,
    before: { status: "withdrawn", withdrawalReason: rider.withdrawalReason, withdrawnAt: rider.withdrawnAt },
    after: { status: restored },
  });

  return NextResponse.json({
    ok: true,
    status: restored,
    message:
      restored === "pending_approval"
        ? "Back in the enrolment approval queue, where they were before."
        : "Rider re-activated. Assign them to a batch to put them back on a roster.",
  });
}
