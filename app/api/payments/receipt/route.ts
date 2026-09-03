import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { getOrgIdForSession } from "@/lib/features-gate";

// Record fees received, with no invoice behind them.
//
// A club that collects privately still needs to answer "how much came in this
// month?" — ₹1,000 from one family, ₹2 lakh from another. Until now it could
// not: Payment.invoiceId was required and invoices are only created by the
// billing flow, so a club with rider billing off could record nothing and its
// revenue read zero forever.
//
// A receipt is a Payment with no invoice. Same table on purpose, so it shows
// up in revenue, exports and the Tally file alongside everything else, and can
// be reversed by the existing machinery when somebody enters the wrong figure.
//
// Deliberately NOT gated on fee-collection: this is the tool for clubs that
// have it switched off.

const schema = z.object({
  riderId: z.string().min(1),
  // No upper bound beyond sanity. The whole complaint was that fees vary
  // wildly and the system assumed a fixed registration amount.
  amount: z.number().positive().max(10_000_000),
  method: z.enum(["cash", "cheque", "upi", "bank", "card"]),
  paidAt: z.string().optional(),
  txnRef: z.string().max(120).optional(),
  note: z.string().max(300).optional(),
  // Screenshot / slip proving the money arrived. Same /uploads whitelist the
  // rest of the app uses — an external URL here would let someone point the
  // club's own records at a host they control.
  proofUrl: z
    .string()
    .regex(/^\/uploads\/[a-z0-9._-]+$/i, "Upload the proof rather than pasting a link")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "finance.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "Pick a rider, an amount and how it was paid." },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });

  // The rider decides the centre — never a centreId from the client, which
  // would let a receipt be filed against a club the caller cannot see.
  const rider = await prisma.rider.findFirst({
    where: {
      id: d.riderId,
      centre: { orgId },
      ...(session.centreId ? { centreId: session.centreId } : {}),
    },
    select: { id: true, centreId: true, firstName: true, lastName: true },
  });
  if (!rider) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const paidAt = d.paidAt ? new Date(d.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    return NextResponse.json({ error: "VALIDATION", message: "That date isn't valid." }, { status: 400 });
  }

  const payment = await prisma.payment.create({
    data: {
      invoiceId: null,
      centreId: rider.centreId,
      riderId: rider.id,
      amount: d.amount,
      method: d.method,
      paidAt,
      // Cash and transfers are money in hand; a cheque is not cleared until
      // it clears, and counting it as revenue on the day it was written is how
      // a bounced cheque quietly overstates a month.
      clearedAt: d.method === "cheque" ? null : paidAt,
      reason: d.note ?? null,
      proofUrl: d.proofUrl ?? null,
      txnRef: d.txnRef || null,
    },
  });

  await audit({
    userId: session.userId,
    action: "payment.receipt_recorded",
    tableName: "payment",
    rowId: payment.id,
    after: {
      rider: `${rider.firstName} ${rider.lastName}`,
      amount: d.amount,
      method: d.method,
      note: d.note ?? null,
      hasProof: Boolean(d.proofUrl),
    },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, id: payment.id, amount: payment.amount });
}
