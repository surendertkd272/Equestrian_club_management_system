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

  // How much of this invoice is still chargeable: face value, less anything
  // already credited. Amounts credited are stored negative, hence the plus.
  const face = inv.amount + inv.gstAmount;
  const alreadyCredited = inv.creditNotes.reduce((t, c) => t + (c.amount + c.gstAmount), 0);
  const creditable = face + alreadyCredited;
  if (creditable <= 0.001) {
    return NextResponse.json(
      { error: "FULLY_CREDITED", message: "This invoice has already been credited in full." },
      { status: 409 },
    );
  }
  // Default = the unpaid balance; explicit = anything up to the full invoice.
  const received = inv.payments.reduce((t, p) => t + p.amount, 0);
  const outstanding = Math.max(0, creditable - received);
  const amount = parsed.data.amount ?? outstanding;
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

  // Split the credit across net and GST in the original's proportion, so the
  // tax position reverses correctly rather than the whole credit landing on net.
  const gstShare = face > 0 ? (inv.gstAmount / face) * amount : 0;
  const netShare = amount - gstShare;

  const note = await prisma.$transaction(async (tx) => {
    const cn = await tx.invoice.create({
      data: {
        centreId: inv.centreId,
        riderId: inv.riderId,
        amount: -netShare,
        gstAmount: -gstShare,
        dueDate: new Date(),
        status: "paid", // nothing is collectable on a credit note
        kind: "credit_note",
        creditNoteForId: inv.id,
      },
    });
    // If the original is now fully covered by payments plus credits, it is
    // settled — a withdrawing family shouldn't keep showing as owing.
    const stillOwed = face + alreadyCredited - amount - received;
    if (stillOwed <= 0.001 && inv.status !== "paid") {
      await tx.invoice.update({ where: { id: inv.id }, data: { status: "paid" } });
    }
    return cn;
  });

  await audit({
    userId: session.userId,
    action: "invoice.credit_note",
    tableName: "invoice",
    rowId: note.id,
    after: {
      creditNoteFor: inv.id,
      amount: -amount,
      net: -netShare,
      gst: -gstShare,
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
    net: netShare,
    gst: gstShare,
    remainingCreditable: creditable - amount,
  });
}
