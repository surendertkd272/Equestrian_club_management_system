// Credit-note arithmetic and the ledger write, shared by the manual
// credit-note route and rider withdrawal.
//
// Both need exactly the same answer to "how much of this invoice is still
// cancellable, and what does the reversing entry look like?" — keeping the
// maths in one place is what stops the two paths drifting into disagreement
// about GST or about what "outstanding" means.

import type { Prisma } from "@prisma/client";

/** Money is stored as a float; keep every derived figure at paise precision. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Take the row lock for an invoice and re-read everything creditPosition needs,
 * INSIDE the transaction. Reading the invoice before opening the transaction
 * and then only wrapping the write is not enough: under READ COMMITTED every
 * concurrent caller sees the same pre-credit snapshot, so they all pass the
 * "you can credit at most X" guard and all write. Two operators, two tabs, or
 * one impatient retry then credit the invoice twice — and a credit note can be
 * neither voided nor credited, so the wrong number is permanent.
 *
 * Same lock the payment and reversal paths take, so credits and payments on one
 * invoice serialise against each other too.
 */
export async function lockAndLoadInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
  return tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      centreId: true,
      riderId: true,
      amount: true,
      gstAmount: true,
      status: true,
      voidedAt: true,
      creditNoteForId: true,
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true, gstAmount: true } },
    },
  });
}

export type CreditPositionInput = {
  amount: number;
  gstAmount: number;
  payments: { amount: number }[];
  creditNotes: { amount: number; gstAmount: number }[];
};

export type CreditPosition = {
  /** Amount + GST as originally billed. */
  face: number;
  /** Sum of credits already issued — negative. */
  alreadyCredited: number;
  /** Face value less credits already issued: the ceiling on a new credit. */
  creditable: number;
  /** Payments net of reversals. */
  received: number;
  /** What the family still actually owes. */
  outstanding: number;
};

export function creditPosition(inv: CreditPositionInput): CreditPosition {
  const face = inv.amount + inv.gstAmount;
  // Credits are stored as negative amounts, hence the plus.
  const alreadyCredited = inv.creditNotes.reduce((t, c) => t + (c.amount + c.gstAmount), 0);
  const creditable = face + alreadyCredited;
  // Reversed payments are negative rows, so this is already net of them.
  const received = inv.payments.reduce((t, p) => t + p.amount, 0);
  return { face, alreadyCredited, creditable, received, outstanding: Math.max(0, creditable - received) };
}

/**
 * Write a credit note as a linked NEGATIVE invoice, and settle the original if
 * payments plus credits now cover it. Caller has already decided the amount is
 * legitimate; this only does the ledger write.
 */
export async function writeCreditNote(
  tx: Prisma.TransactionClient,
  inv: { id: string; centreId: string; riderId: string; amount: number; gstAmount: number; status: string },
  position: CreditPosition,
  amount: number,
): Promise<{ id: string; net: number; gst: number }> {
  // Split across net and GST in the original's proportion, so the tax position
  // reverses correctly rather than the whole credit landing on net.
  // Round the split, or 6800 x 1800/11800 stores 1037.2881355932204 and the
  // family's statement shows sub-paise figures the notification never promised.
  const gstShare = round2(position.face > 0 ? (inv.gstAmount / position.face) * amount : 0);
  const netShare = round2(amount - gstShare);

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
  const stillOwed = position.creditable - amount - position.received;
  if (stillOwed <= 0.001 && inv.status !== "paid") {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "paid" } });
  }

  return { id: cn.id, net: netShare, gst: gstShare };
}
