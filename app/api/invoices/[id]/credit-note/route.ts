// Issue a credit note against an invoice — the instrument for cancelling what
// a family owes once the original can no longer simply be voided: they have
// paid or part-paid it, they left mid-term, they were over-billed, or the club
// is making a goodwill adjustment.
//
// Modelled as a linked NEGATIVE invoice rather than an edit of the original.
// Both stay on the ledger and net to what is actually owed, which is how a
// credit note works on paper and what an auditor expects to see. It also means
// every existing "sum the invoices" query gets the right answer with no change.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { blockIfFeatureOff, getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { notifyRiderAndParents } from "@/lib/notify";
import { creditPosition, writeCreditNote, lockAndLoadInvoice } from "@/lib/credit-note";
import { tracksDues } from "@/lib/money-contact";

const schema = z.object({
  // Omit to cancel what is still OWED — the common case, a family withdrawing
  // mid-term who should simply stop being chased. Supply an amount to go
  // further, up to the full invoice, when the club genuinely intends to refund
  // money already received. Defaulting to the full face value instead would
  // quietly create a refund liability nobody asked for.
  amount: z.coerce.number().positive().max(10_000_000).optional(),
  reason: z.string().min(3).max(300),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Not gated on parent-facing billing: correcting a due the club recorded for
  // its own books must stay possible whether or not the family is ever shown
  // it. Same reasoning as void.
  //
  // tracksDues() rather than a bare dues-tracking check, because a club that
  // has been billing for a year has never set the new flag — keying on it
  // alone would silently remove credit notes from every existing customer.
  if (!(await tracksDues(await getOrgIdForSession(session)))) {
    return NextResponse.json(
      { error: "FEATURE_OFF", message: "This club does not track dues." },
      { status: 403 },
    );
  }
  if (!can(session.role, "finance.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "A reason is required to issue a credit note.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Everything from here — the re-read, every guard, and the write — happens
  // under a row lock on the invoice. Checking "how much is left to credit"
  // against a snapshot taken before the transaction let concurrent callers all
  // pass the same guard and all write; four parallel requests credited an
  // ₹11,800 invoice ₹47,200, and a credit note can be neither voided nor
  // credited, so nothing in the product could undo it.
  // Everything from here — the re-read, every guard, and the write — happens
  // under a row lock on the invoice. Checking "how much is left to credit"
  // against a snapshot taken before the transaction let concurrent callers all
  // pass the same guard and all write: four parallel requests credited an
  // ₹11,800 invoice ₹47,200. A credit note can be neither voided nor credited,
  // so nothing in the product could undo it.
  type Fail = { ok: false; status: number; body: Record<string, unknown> };
  type Done = {
    ok: true;
    note: { id: string; net: number; gst: number };
    amount: number;
    riderId: string;
    centreId: string;
    remaining: number;
  };
  const fail = (status: number, body: Record<string, unknown>): Fail => ({ ok: false, status, body });

  // Resolve the org fence BEFORE the transaction. getOrgIdForSession and
  // getOrgIdForCentre run against the GLOBAL prisma client; calling them from
  // inside $transaction takes a second pool connection while holding the first,
  // which deadlocks the pool once a few requests overlap.
  const head = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: { centreId: true },
  });
  let fenceError: string | null = null;
  if (head) {
    const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
    if (isHQ) {
      const [callerOrg, rowOrg] = await Promise.all([
        getOrgIdForSession(session),
        getOrgIdForCentre(head.centreId),
      ]);
      if (!callerOrg || callerOrg !== rowOrg) fenceError = "FORBIDDEN_CROSS_ORG";
    } else if (head.centreId !== session.centreId) {
      fenceError = "FORBIDDEN_CROSS_CENTRE";
    }
  }

  const outcome: Fail | Done = await prisma.$transaction(async (tx) => {
    const inv = await lockAndLoadInvoice(tx, params.id);
    if (!inv) return fail(404, { error: "NOT_FOUND" });
    if (fenceError) return fail(403, { error: fenceError });
    if (inv.creditNoteForId) {
      return fail(409, { error: "IS_CREDIT_NOTE", message: "You can't credit a credit note." });
    }
    if (inv.voidedAt) {
      return fail(409, { error: "INVOICE_VOID", message: "This invoice was voided, so there is nothing to credit." });
    }

    const position = creditPosition(inv);
    if (position.creditable <= 0.001) {
      return fail(409, { error: "FULLY_CREDITED", message: "This invoice has already been credited in full." });
    }
    // Default = the unpaid balance; explicit = anything up to the full invoice.
    const amount = parsed.data.amount ?? position.outstanding;
    if (amount <= 0.001) {
      return fail(409, {
        error: "NOTHING_OUTSTANDING",
        message:
          "This invoice is fully paid, so there is nothing left to cancel. " +
          "To refund money already received, pass the amount explicitly.",
      });
    }
    if (amount > position.creditable + 0.001) {
      return fail(409, {
        error: "EXCEEDS_INVOICE",
        creditable: position.creditable,
        message: `You can credit at most ₹${position.creditable.toLocaleString("en-IN")} against this invoice.`,
      });
    }

    const note = await writeCreditNote(tx, inv, position, amount);
    return {
      ok: true,
      note,
      amount,
      riderId: inv.riderId,
      centreId: inv.centreId,
      remaining: position.creditable - amount,
    };
  });

  if (!outcome.ok) return NextResponse.json(outcome.body, { status: outcome.status });
  const { note, amount, riderId, centreId, remaining } = outcome;
  const centre = await prisma.centre.findUnique({ where: { id: centreId }, select: { name: true } });

  await audit({
    userId: session.userId,
    action: "invoice.credit_note",
    tableName: "invoice",
    rowId: note.id,
    after: {
      creditNoteFor: params.id,
      amount: -amount,
      net: -note.net,
      gst: -note.gst,
      reason: parsed.data.reason,
      riderId,
    },
  });

  // The family should hear that a charge was cancelled without having to ask.
  await notifyRiderAndParents(riderId, {
    type: "invoice.credit_note",
    title: `₹${Math.round(amount).toLocaleString("en-IN")} credited to your account`,
    body: `${centre?.name ?? "The centre"} has credited ₹${Math.round(amount).toLocaleString("en-IN")} against an earlier invoice. Reason: ${parsed.data.reason}`,
    link: `/parent`,
  });

  return NextResponse.json({
    ok: true,
    creditNoteId: note.id,
    amount,
    net: note.net,
    gst: note.gst,
    remainingCreditable: remaining,
  });
}
