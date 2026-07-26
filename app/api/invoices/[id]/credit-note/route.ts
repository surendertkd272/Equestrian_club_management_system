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
import { blockIfFeatureOff } from "@/lib/features-gate";
import { notifyRiderAndParents } from "@/lib/notify";
import { creditPosition, writeCreditNote } from "@/lib/credit-note";

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
  const featureBlock = await blockIfFeatureOff(session, "fee-collection");
  if (featureBlock) return featureBlock;
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

  const inv = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true, gstAmount: true } },
      rider: { select: { id: true, firstName: true, lastName: true } },
      centre: { select: { name: true } },
    },
  });
  if (!inv) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && inv.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (inv.creditNoteForId) {
    return NextResponse.json({ error: "IS_CREDIT_NOTE", message: "You can't credit a credit note." }, { status: 409 });
  }
  if (inv.voidedAt) {
    return NextResponse.json(
      { error: "INVOICE_VOID", message: "This invoice was voided, so there is nothing to credit." },
      { status: 409 },
    );
  }

  // How much of this invoice is still chargeable, what has been paid, and what
  // is genuinely outstanding. Shared with rider withdrawal (lib/credit-note.ts)
  // so the two paths can't disagree about the maths.
  const position = creditPosition(inv);
  const { face, creditable } = position;
  if (creditable <= 0.001) {
    return NextResponse.json(
      { error: "FULLY_CREDITED", message: "This invoice has already been credited in full." },
      { status: 409 },
    );
  }
  // Default = the unpaid balance; explicit = anything up to the full invoice.
  const amount = parsed.data.amount ?? position.outstanding;
  if (amount <= 0.001) {
    return NextResponse.json(
      {
        error: "NOTHING_OUTSTANDING",
        message:
          "This invoice is fully paid, so there is nothing left to cancel. " +
          "To refund money already received, pass the amount explicitly.",
      },
      { status: 409 },
    );
  }
  if (amount > creditable + 0.001) {
    return NextResponse.json(
      {
        error: "EXCEEDS_INVOICE",
        creditable,
        message: `You can credit at most ₹${creditable.toLocaleString("en-IN")} against this invoice.`,
      },
      { status: 409 },
    );
  }

  const note = await prisma.$transaction((tx) => writeCreditNote(tx, inv, position, amount));

  await audit({
    userId: session.userId,
    action: "invoice.credit_note",
    tableName: "invoice",
    rowId: note.id,
    after: {
      creditNoteFor: inv.id,
      amount: -amount,
      net: -note.net,
      gst: -note.gst,
      reason: parsed.data.reason,
      riderId: inv.riderId,
    },
  });

  // The family should hear that a charge was cancelled without having to ask.
  await notifyRiderAndParents(inv.riderId, {
    type: "invoice.credit_note",
    title: `₹${Math.round(amount).toLocaleString("en-IN")} credited to your account`,
    body: `${inv.centre.name} has credited ₹${Math.round(amount).toLocaleString("en-IN")} against an earlier invoice. Reason: ${parsed.data.reason}`,
    link: `/parent`,
  });

  return NextResponse.json({
    ok: true,
    creditNoteId: note.id,
    amount,
    net: note.net,
    gst: note.gst,
    remainingCreditable: creditable - amount,
  });
}
