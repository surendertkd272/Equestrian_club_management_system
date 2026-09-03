import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { makeCentreFence } from "@/lib/authz-centre";
import { creditPosition, lockAndLoadInvoice } from "@/lib/credit-note";
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
    include: {
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true, gstAmount: true } },
    },
  });

  let marked = 0;
  const skipped: { invoiceId: string; reason: string }[] = [];
  // One fence for the whole batch — see makeCentreFence.
  const fence = makeCentreFence(session);
  for (const inv of invoices) {
    // HQ roles have centreId = null, so this comparison used to skip EVERY
    // row for an ADMIN — the bulk action silently did nothing for them.
    if (await fence(inv.centreId)) {
      skipped.push({ invoiceId: inv.id, reason: "cross-centre" });
      continue;
    }
    if (inv.status === "paid") {
      skipped.push({ invoiceId: inv.id, reason: "already paid" });
      continue;
    }
    if (inv.voidedAt) {
      skipped.push({ invoiceId: inv.id, reason: "void" });
      continue;
    }
    if (inv.creditNoteForId) {
      skipped.push({ invoiceId: inv.id, reason: "credit_note" });
      continue;
    }
    if (inv.status === "refunded") {
      skipped.push({ invoiceId: inv.id, reason: "refunded" });
      continue;
    }
    // Everything below runs under the invoice's row lock, re-reading the
    // position inside it. The pre-read above is only a fast path for the skip
    // reasons: two operators hitting "mark paid" on the same list — or one
    // impatient double-click — otherwise each banked the full outstanding
    // amount against a stale snapshot, exactly the race the credit-note and
    // reversal routes were fixed for. Same lock, same reason.
    const outcome = await prisma.$transaction(async (tx) => {
      const fresh = await lockAndLoadInvoice(tx, inv.id);
      if (!fresh || fresh.voidedAt || fresh.creditNoteForId) return "gone" as const;
      const remaining = creditPosition(fresh).outstanding;
      if (remaining < 0.01) return "settled" as const;
      await tx.payment.create({
        data: {
          invoiceId: inv.id,
          // Denormalised from the invoice so finance queries can scope on the
          // payment itself — receipts have no invoice to scope through.
          centreId: inv.centreId,
          riderId: inv.riderId,
          amount: remaining,
          method: parsed.data.method,
          paidAt: new Date(),
          clearedAt: parsed.data.method === "cheque" ? null : new Date(),
        },
      });
      await tx.invoice.update({ where: { id: inv.id }, data: { status: "paid" } });
      return "paid" as const;
    });
    if (outcome !== "paid") {
      skipped.push({ invoiceId: inv.id, reason: outcome === "gone" ? "cancelled" : "nothing outstanding" });
      continue;
    }
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
