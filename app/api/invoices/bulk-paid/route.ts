import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { bulkMarkPaidSchema } from "@/lib/schemas/payment";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Bulk-pay flow for the finance dashboard. For each invoice id supplied:
//   1. Skip if the invoice is already paid or refunded.
//   2. Compute remaining = (amount + gstAmount) - sumPayments.
//   3. Insert a Payment for the remaining amount + mark invoice paid.
// Skipped invoices come back in the response so the UI can show which ones
// were already covered or out of scope.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "finance.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  // Note: NOT gated by fee-collection — staff bookkeeping (recording an
  // offline cash/cheque payment against a still-due invoice) must keep
  // working even when the parent-facing online payment flow is off.
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = bulkMarkPaidSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: parsed.data.invoiceIds } },
    include: { payments: { select: { amount: true } } },
  });

  let marked = 0;
  const skipped: { invoiceId: string; reason: string }[] = [];
  for (const inv of invoices) {
    if (session.role !== "SUPER_ADMIN" && inv.centreId !== session.centreId) {
      skipped.push({ invoiceId: inv.id, reason: "cross-centre" });
      continue;
    }
    if (inv.status === "paid") {
      skipped.push({ invoiceId: inv.id, reason: "already paid" });
      continue;
    }
    if (inv.status === "refunded") {
      skipped.push({ invoiceId: inv.id, reason: "refunded" });
      continue;
    }
    const target = inv.amount + inv.gstAmount;
    const already = inv.payments.reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, target - already);
    if (remaining < 0.01) {
      skipped.push({ invoiceId: inv.id, reason: "nothing outstanding" });
      continue;
    }
    await prisma.payment.create({
      data: {
        invoiceId: inv.id,
        amount: remaining,
        method: parsed.data.method,
        paidAt: new Date(),
        clearedAt: parsed.data.method === "cheque" ? null : new Date(),
      },
    });
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "paid" } });
    marked++;
  }

  await audit({
    userId: session.userId,
    action: "invoice.bulk_mark_paid",
    tableName: "invoice",
    rowId: parsed.data.invoiceIds.join(","),
    after: { method: parsed.data.method, marked, skippedCount: skipped.length },
  });

  return NextResponse.json({ marked, skipped });
}
