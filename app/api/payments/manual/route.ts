import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
  if (session.role !== "SUPER_ADMIN" && inv.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (inv.status === "refunded") {
    return NextResponse.json({ error: "INVOICE_REFUNDED" }, { status: 409 });
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
  try {
    const r = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${inv.id} FOR UPDATE`;
      const agg = await tx.payment.aggregate({ where: { invoiceId: inv.id }, _sum: { amount: true } });
      const alreadyPaid = agg._sum.amount ?? 0;
      if (parsed.data.amount > target - alreadyPaid + 0.001) {
        throw new Overpay(target - alreadyPaid);
      }
      const p = await tx.payment.create({
        data: {
          invoiceId: inv.id,
          amount: parsed.data.amount,
          method: parsed.data.method,
          txnRef: parsed.data.txnRef,
          paidAt,
          clearedAt: parsed.data.method === "cheque" ? null : paidAt,
        },
      });
      const totalPaid = alreadyPaid + parsed.data.amount;
      const status = totalPaid >= target - 0.001 ? "paid" : "due";
      // Unconditional update under the lock — idempotent if status is unchanged.
      await tx.invoice.update({ where: { id: inv.id }, data: { status } });
      return { payment: p, newStatus: status, newTotalPaid: totalPaid };
    });
    payment = r.payment;
    newStatus = r.newStatus;
    newTotalPaid = r.newTotalPaid;
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
    outstanding: Math.max(0, target - newTotalPaid),
  });
}
