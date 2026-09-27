// Say which month's fee a payment was.
//
// Money received against no invoice was filed as an "advance" whenever a family
// paid more than the invoice in front of the operator — but at this club the
// extra is almost always the month's fee, recorded for the club's own records.
// This relabels such a payment as "Monthly fee — Sep 2026" (or moves it to a
// different month). The amount, date and method are untouched: this changes
// what the money was FOR, never how much came in, so it is an edit and not a
// reversal. The before/after goes to the audit log.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { centreFence } from "@/lib/authz-centre";
import { FEE_MONTH_RE, formatFeeMonth } from "@/lib/fee-month";

const schema = z.object({ feeMonth: z.string().regex(FEE_MONTH_RE) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "finance.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", message: "Pick a month." }, { status: 400 });
  }

  const p = await prisma.payment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      centreId: true,
      invoiceId: true,
      amount: true,
      reason: true,
      feeMonth: true,
      reversalOfId: true,
      reversals: { select: { id: true } },
    },
  });
  if (!p) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, p.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });

  // Only money held against no invoice. An invoice payment already says what
  // it was for, and a reversal (or a reversed payment) is not money held.
  if (p.invoiceId || p.amount <= 0 || p.reversalOfId || p.reversals.length > 0) {
    return NextResponse.json(
      { error: "NOT_RELABELLABLE", message: "Only a payment kept on the rider's account can be marked as a monthly fee." },
      { status: 409 },
    );
  }

  const feeMonth = parsed.data.feeMonth;
  // Keep the original note after the new label: "paid ₹5000 against a ₹3000
  // registration invoice · ref …" is what matches it to the bank statement.
  const original = (p.reason ?? "").replace(/^(Advance|Monthly fee — [A-Za-z]{3} \d{4})( — | · )?/, "");
  const reason = `Monthly fee — ${formatFeeMonth(feeMonth)}${original ? ` · ${original}` : ""}`;

  await prisma.payment.update({ where: { id: p.id }, data: { feeMonth, reason } });
  await audit({
    userId: session.userId,
    action: "payment.fee_month_set",
    tableName: "payment",
    rowId: p.id,
    before: { feeMonth: p.feeMonth, reason: p.reason },
    after: { feeMonth, reason },
  });

  return NextResponse.json({ ok: true, feeMonth, reason });
}
