import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { recordPaymentSchema } from "@/lib/schemas/payment";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Thrown inside the payment transaction when, under the invoice row lock, the
// recomputed outstanding can't cover this payment (lost an overpay race).
class Overpay extends Error {
  outstanding: number;
  constructor(outstanding: number) {
    super("OVERPAY");
    this.outstanding = outstanding;
  }
}

// Records a non-Razorpay payment against an invoice. Updates the invoice
// to "paid" only when cumulative payments meet the (amount + gstAmount).
// Partial payments leave the invoice in "due" — totals are computed from
// the Payment table on read so we never get out-of-sync.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "finance.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = recordPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const inv = await prisma.invoice.findUnique({
    where: { id: parsed.data.invoiceId },
  });
  if (!inv) return NextResponse.json({ error: "INVOICE_NOT_FOUND" }, { status: 404 });
  // HQ roles have centreId = null: this comparison locked ADMIN out of every
  // centre while fencing no organisation at all. centreFence does both.
  const fence = await centreFence(session, inv.centreId);
  if (fence) {
    return NextResponse.json({ error: fence }, { status: 403 });
  }
  if (inv.status === "refunded") {
    return NextResponse.json({ error: "INVOICE_REFUNDED" }, { status: 409 });
  }
  // A voided invoice is cancelled — taking money against it would silently
  // resurrect it (the status flip below would move it off "void") and leave a
  // receipt for a charge the club withdrew.
  if (inv.voidedAt) {
    return NextResponse.json(
      { error: "INVOICE_VOID", message: "This invoice was voided. Raise a new one to collect." },
      { status: 409 },
    );
  }
  // You cannot pay a credit note; it is money owed the other way.
  if (inv.creditNoteForId) {
    return NextResponse.json(
      { error: "IS_CREDIT_NOTE", message: "That's a credit note, not a bill." },
      { status: 409 },
    );
  }
  const target = inv.amount + inv.gstAmount;
  const paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date();

  // C5b — serialize payments per invoice. Lock the invoice row, then recompute
  // the paid total from the Payment table INSIDE the lock so the overpay guard
  // and the status flip can't be raced by a concurrent payment (which used to
  // let two payments each pass a stale "0 paid" check and overpay the invoice,
  // and clobber each other's status update). The pre-read above is only used
  // for the not-found / cross-centre / refunded fast-path.
  let payment: Awaited<ReturnType<typeof prisma.payment.create>>;
  let newStatus: string;
  let newTotalPaid: number;
  let collectableTotal: number;
  try {
    const r = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${inv.id} FOR UPDATE`;
      const agg = await tx.payment.aggregate({ where: { invoiceId: inv.id }, _sum: { amount: true } });
      const alreadyPaid = agg._sum.amount ?? 0;
      // Credit notes reduce what is collectable. Without this the club can
      // still take the full face value on an invoice it has already partly
      // cancelled — the credited amount gets collected twice over.
      const credits = await tx.invoice.aggregate({
        where: { creditNoteForId: inv.id },
        _sum: { amount: true, gstAmount: true },
      });
      const collectable =
        target + (credits._sum.amount ?? 0) + (credits._sum.gstAmount ?? 0);
      if (parsed.data.amount > collectable - alreadyPaid + 0.001) {
        throw new Overpay(Math.max(0, collectable - alreadyPaid));
      }
      const p = await tx.payment.create({
        data: {
          invoiceId: inv.id,
          centreId: inv.centreId,
          riderId: inv.riderId,
          amount: parsed.data.amount,
          method: parsed.data.method,
          txnRef: parsed.data.txnRef,
          paidAt,
          clearedAt: parsed.data.method === "cheque" ? null : paidAt,
        },
      });
      const totalPaid = alreadyPaid + parsed.data.amount;
      const status = totalPaid >= collectable - 0.001 ? "paid" : "due";
      // Unconditional update under the lock — idempotent if status is unchanged.
      await tx.invoice.update({ where: { id: inv.id }, data: { status } });
      return { payment: p, newStatus: status, newTotalPaid: totalPaid, collectable };
    });
    payment = r.payment;
    newStatus = r.newStatus;
    newTotalPaid = r.newTotalPaid;
    collectableTotal = r.collectable;
  } catch (e) {
    if (e instanceof Overpay) {
      return NextResponse.json(
        {
          error: "OVERPAY",
          message: `Invoice has ${e.outstanding.toFixed(2)} outstanding; you tried to record ${parsed.data.amount}.`,
        },
        { status: 409 },
      );
    }
    throw e;
  }

  await audit({
    userId: session.userId,
    action: "payment.record_manual",
    tableName: "payment",
    rowId: payment.id,
    after: { invoiceId: inv.id, amount: payment.amount, method: payment.method, newStatus },
  });

  return NextResponse.json({
    ok: true,
    paymentId: payment.id,
    invoiceStatus: newStatus,
    totalPaid: newTotalPaid,
    outstanding: Math.max(0, collectableTotal - newTotalPaid),
  });
}
