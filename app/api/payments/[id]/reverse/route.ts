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
import { blockIfFeatureOff, getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";

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

  // The guards below run INSIDE the invoice lock. Reading the payment and its
  // reversals first and only locking for the write let concurrent callers all
  // pass ALREADY_REVERSED on the same stale read and all write a compensating
  // row — one ₹11,800 receipt reversed three times leaves the invoice at
  // −₹23,600 collected. Everything now re-reads under the lock.
  type Fail = { ok: false; status: number; body: Record<string, unknown> };
  type Done = { ok: true; reversalId: string; status: string; totalPaid: number; target: number; original: { id: string; amount: number; method: string; txnRef: string | null; invoiceStatusWas: string } };
  const fail = (status: number, body: Record<string, unknown>): Fail => ({ ok: false, status, body });

  // Resolve the org fence BEFORE opening the transaction. getOrgIdForSession /
  // getOrgIdForCentre run against the GLOBAL prisma client; calling them inside
  // a $transaction borrows a second connection while holding the first, which
  // deadlocks the pool under load.
  const head0 = await prisma.payment.findUnique({
    where: { id: params.id },
    select: { invoice: { select: { centreId: true } } },
  });
  let fenceError: string | null = null;
  if (head0) {
    const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
    if (isHQ) {
      const [callerOrg, rowOrg] = await Promise.all([
        getOrgIdForSession(session),
        getOrgIdForCentre(head0.invoice.centreId),
      ]);
      if (!callerOrg || callerOrg !== rowOrg) fenceError = "FORBIDDEN_CROSS_ORG";
    } else if (head0.invoice.centreId !== session.centreId) {
      fenceError = "FORBIDDEN_CROSS_CENTRE";
    }
  }

  const outcome: Fail | Done = await prisma.$transaction(async (tx) => {
    const head = await tx.payment.findUnique({
      where: { id: params.id },
      select: { invoiceId: true },
    });
    if (!head) return fail(404, { error: "NOT_FOUND" });
    // Lock the invoice first, then re-read the payment under it — the same
    // lock app/api/payments/manual and the credit-note route take, so payments,
    // credits and reversals on one invoice all serialise against each other.
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${head.invoiceId} FOR UPDATE`;
    const original = await tx.payment.findUnique({
      where: { id: params.id },
      include: {
        invoice: { select: { id: true, centreId: true, amount: true, gstAmount: true, status: true } },
        reversals: { select: { id: true } },
      },
    });
    if (!original) return fail(404, { error: "NOT_FOUND" });
    if (fenceError) return fail(403, { error: fenceError });
    if (original.amount < 0) {
      return fail(409, { error: "IS_REVERSAL", message: "That row is itself a reversal. Record a fresh payment instead." });
    }
    if (original.reversals.length > 0) {
      return fail(409, { error: "ALREADY_REVERSED", reversedBy: original.reversals[0].id });
    }

    // Net of credit notes — the same figure the payment path collects against.
    // Face value here would put a fully-credited invoice back to "due".
    const credits = await tx.invoice.aggregate({
      where: { creditNoteForId: original.invoiceId },
      _sum: { amount: true, gstAmount: true },
    });
    const target =
      original.invoice.amount +
      original.invoice.gstAmount +
      (credits._sum.amount ?? 0) +
      (credits._sum.gstAmount ?? 0);
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
    return {
      ok: true,
      reversalId: r.id,
      status: next,
      totalPaid: paid,
      target,
      original: {
        id: original.id,
        amount: original.amount,
        method: original.method,
        txnRef: original.txnRef,
        invoiceStatusWas: original.invoice.status,
      },
    };
  });

  if (!outcome.ok) return NextResponse.json(outcome.body, { status: outcome.status });
  const { reversalId, status, totalPaid, target, original } = outcome;

  await audit({
    userId: session.userId,
    action: "payment.reverse",
    tableName: "payment",
    rowId: reversalId,
    before: {
      originalPaymentId: original.id,
      amount: original.amount,
      method: original.method,
      txnRef: original.txnRef,
      invoiceStatusWas: original.invoiceStatusWas,
    },
    after: { amount: -original.amount, reason: parsed.data.reason, note: parsed.data.note ?? null, invoiceStatusNow: status },
  });

  return NextResponse.json({
    ok: true,
    reversalId,
    invoiceStatus: status,
    totalPaid,
    outstanding: Math.max(0, target - totalPaid),
  });
}
