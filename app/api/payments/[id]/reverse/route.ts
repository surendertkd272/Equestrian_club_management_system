// Reverse a payment — a cheque bounced, a receipt was entered against the
// wrong rider, cash was double-entered, or the club refunded the family.
//
// Recorded as a NEW row with a negative amount pointing at the original, never
// as an edit or a delete. Three reasons that matters:
//   • the original receipt was given to a family and must stay on the ledger;
//   • the audit trail keeps both halves, so "what happened" is reconstructable;
//   • every existing balance query is `sum(amount)` over payments, so the
//     invoice's outstanding figure recomputes correctly with no other change.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { blockIfFeatureOff } from "@/lib/features-gate";

const REASONS = ["bounced", "entered_in_error", "refunded", "other"] as const;

const schema = z.object({
  reason: z.enum(REASONS),
  note: z.string().max(300).optional(),
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
      {
        error: "VALIDATION",
        message: `Say why: one of ${REASONS.join(", ")}.`,
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const original = await prisma.payment.findUnique({
    where: { id: params.id },
    include: { invoice: { select: { id: true, centreId: true, amount: true, gstAmount: true, status: true } }, reversals: true },
  });
  if (!original) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && original.invoice.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (original.amount < 0) {
    return NextResponse.json(
      { error: "IS_REVERSAL", message: "That row is itself a reversal. Record a fresh payment instead." },
      { status: 409 },
    );
  }
  if (original.reversals.length > 0) {
    return NextResponse.json(
      { error: "ALREADY_REVERSED", reversedBy: original.reversals[0].id },
      { status: 409 },
    );
  }

  const target = original.invoice.amount + original.invoice.gstAmount;

  const { reversal, status, totalPaid } = await prisma.$transaction(async (tx) => {
    // Same lock the payment path takes, so a concurrent payment and reversal
    // can't both read a stale balance and leave the status wrong.
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${original.invoice.id} FOR UPDATE`;
    const r = await tx.payment.create({
      data: {
        invoiceId: original.invoiceId,
        amount: -original.amount,
        method: original.method,
        paidAt: new Date(),
        // A reversal moves no money of its own, so it never counts as cleared.
        clearedAt: null,
        reversalOfId: original.id,
        reason: parsed.data.note ? `${parsed.data.reason}: ${parsed.data.note}` : parsed.data.reason,
      },
    });
    const agg = await tx.payment.aggregate({ where: { invoiceId: original.invoiceId }, _sum: { amount: true } });
    const paid = agg._sum.amount ?? 0;
    const next = paid >= target - 0.001 ? "paid" : "due";
    await tx.invoice.update({ where: { id: original.invoiceId }, data: { status: next } });
    return { reversal: r, status: next, totalPaid: paid };
  });

  await audit({
    userId: session.userId,
    action: "payment.reverse",
    tableName: "payment",
    rowId: reversal.id,
    before: {
      originalPaymentId: original.id,
      amount: original.amount,
      method: original.method,
      txnRef: original.txnRef,
      invoiceStatusWas: original.invoice.status,
    },
    after: { amount: -original.amount, reason: parsed.data.reason, note: parsed.data.note ?? null, invoiceStatusNow: status },
  });

  return NextResponse.json({
    ok: true,
    reversalId: reversal.id,
    invoiceStatus: status,
    totalPaid,
    outstanding: Math.max(0, target - totalPaid),
  });
}
