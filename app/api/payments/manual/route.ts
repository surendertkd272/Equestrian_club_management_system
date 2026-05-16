import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { recordPaymentSchema } from "@/lib/schemas/payment";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

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
    include: { payments: { select: { amount: true } } },
  });
  if (!inv) return NextResponse.json({ error: "INVOICE_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && inv.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (inv.status === "refunded") {
    return NextResponse.json({ error: "INVOICE_REFUNDED" }, { status: 409 });
  }

  const target = inv.amount + inv.gstAmount;
  const alreadyPaid = inv.payments.reduce((s, p) => s + p.amount, 0);
  if (parsed.data.amount > target - alreadyPaid + 0.001) {
    return NextResponse.json(
      {
        error: "OVERPAY",
        message: `Invoice has ${(target - alreadyPaid).toFixed(2)} outstanding; you tried to record ${parsed.data.amount}.`,
      },
      { status: 409 },
    );
  }

  const paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date();
  const payment = await prisma.payment.create({
    data: {
      invoiceId: inv.id,
      amount: parsed.data.amount,
      method: parsed.data.method,
      txnRef: parsed.data.txnRef,
      paidAt,
      clearedAt: parsed.data.method === "cheque" ? null : paidAt,
    },
  });

  const newTotalPaid = alreadyPaid + parsed.data.amount;
  const newStatus = newTotalPaid >= target - 0.001 ? "paid" : "due";
  if (newStatus !== inv.status) {
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: newStatus } });
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
