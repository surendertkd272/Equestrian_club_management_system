// Edit or delete a recorded fee.
//
// The club records monthly fees for its own books, and a fee is sometimes
// entered wrong or changes afterwards. The rest of the ledger is reverse-only
// (see ./reverse), and that stays true for anything touching an invoice: an
// invoice's paid/due status is computed from its payments, and the family
// holds a receipt for it.
//
// What CAN be edited or deleted here is money held against no invoice (a
// monthly fee, an untyped fee received, or a legacy advance) that has not been
// reversed. The full before/after goes to the audit log, so an edit or delete
// is never silent: "who changed Aarav's September fee from ₹4,000 to ₹3,500"
// stays answerable.
//
// Finance roles only. A coach can record a fee but not change one afterwards —
// the owner's rule is no changes by coaches without a manager.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { centreFence } from "@/lib/authz-centre";
import { FEE_MONTH_RE, formatFeeMonth } from "@/lib/fee-month";
import type { SessionPayload } from "@/lib/auth";

const editSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  feeMonth: z.string().regex(FEE_MONTH_RE),
  method: z.enum(["cash", "cheque", "upi", "bank", "card"]),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(300).optional(),
});

const SELECT = {
  id: true,
  centreId: true,
  riderId: true,
  invoiceId: true,
  amount: true,
  method: true,
  paidAt: true,
  clearedAt: true,
  feeMonth: true,
  reason: true,
  txnRef: true,
  reversalOfId: true,
  recordedByUserId: true,
  reversals: { select: { id: true } },
} as const;

type Loaded = { ok: true; p: NonNullable<Awaited<ReturnType<typeof load>>> } | { ok: false; res: NextResponse };

async function load(id: string) {
  return prisma.payment.findUnique({ where: { id }, select: SELECT });
}

async function guard(session: SessionPayload | null, id: string): Promise<Loaded> {
  if (!session) return { ok: false, res: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!can(session.role, "finance.write")) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "FORBIDDEN", message: "Ask a manager to change a recorded fee." },
        { status: 403 },
      ),
    };
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return { ok: false, res: readOnly };
  const p = await load(id);
  if (!p) return { ok: false, res: NextResponse.json({ error: "NOT_FOUND" }, { status: 404 }) };
  const fence = await centreFence(session, p.centreId);
  if (fence) return { ok: false, res: NextResponse.json({ error: fence }, { status: 403 }) };
  if (p.invoiceId || p.amount <= 0 || p.reversalOfId || p.reversals.length > 0) {
    return {
      ok: false,
      res: NextResponse.json(
        {
          error: "NOT_EDITABLE",
          message: p.invoiceId
            ? "This payment settles an invoice. Use Reverse instead."
            : "A reversed payment can't be edited or deleted.",
        },
        { status: 409 },
      ),
    };
  }
  return { ok: true, p };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const g = await guard(session, params.id);
  if (!g.ok) return g.res;
  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "Check the month, amount, method and date." },
      { status: 400 },
    );
  }
  const d = parsed.data;
  // Stored the way Record Monthly Fee stores it, so both display the same day.
  const paidAt = new Date(d.paidAt);
  if (Number.isNaN(paidAt.getTime())) {
    return NextResponse.json({ error: "VALIDATION", message: "That date isn't valid." }, { status: 400 });
  }
  const note = d.note?.trim() ?? "";
  const reason = `Monthly fee — ${formatFeeMonth(d.feeMonth)}${note ? ` · ${note}` : ""}`;
  // Same rule as recording: a cheque is not money until it clears. Keep an
  // already-cleared cheque cleared; a switch TO cheque starts uncleared.
  const clearedAt = d.method === "cheque" ? (g.p.method === "cheque" ? g.p.clearedAt : null) : paidAt;

  const updated = await prisma.payment.update({
    where: { id: g.p.id },
    data: { amount: d.amount, feeMonth: d.feeMonth, method: d.method, paidAt, clearedAt, reason },
    select: { id: true, amount: true, feeMonth: true, method: true, paidAt: true, reason: true },
  });
  await audit({
    userId: session!.userId,
    action: "payment.fee_edited",
    tableName: "payment",
    rowId: g.p.id,
    before: {
      amount: g.p.amount,
      feeMonth: g.p.feeMonth,
      method: g.p.method,
      paidAt: g.p.paidAt,
      reason: g.p.reason,
    },
    after: updated,
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true, payment: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const g = await guard(session, params.id);
  if (!g.ok) return g.res;
  await prisma.payment.delete({ where: { id: g.p.id } });
  // The whole row goes to the audit log: this is the only copy left of it.
  const { reversals: _r, ...snapshot } = g.p;
  await audit({
    userId: session!.userId,
    action: "payment.fee_deleted",
    tableName: "payment",
    rowId: g.p.id,
    before: snapshot,
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
