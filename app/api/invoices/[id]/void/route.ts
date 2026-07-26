// Void an invoice that should never have existed — raised in error, a
// duplicate, the wrong rider. Soft: the row and its number stay on the ledger
// with who voided it and why, because an issued invoice number cannot simply
// vanish from the books.
//
// Deliberately refused once money has been received against it. An invoice a
// family has paid is a real event; erasing it would leave their payment
// pointing at nothing. Use a credit note for that case instead — the endpoint
// says so explicitly rather than failing with a bare code.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { blockIfFeatureOff } from "@/lib/features-gate";

const schema = z.object({ reason: z.string().min(3).max(300) });

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
      { error: "VALIDATION", message: "A reason is required to void an invoice.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const inv = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: { payments: { select: { amount: true } } },
  });
  if (!inv) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && inv.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (inv.voidedAt) {
    return NextResponse.json({ error: "ALREADY_VOID", voidedAt: inv.voidedAt }, { status: 409 });
  }
  if (inv.creditNoteForId) {
    return NextResponse.json(
      { error: "IS_CREDIT_NOTE", message: "A credit note can't be voided. Reverse it with a fresh invoice if it was wrong." },
      { status: 409 },
    );
  }

  // Net of reversals — a payment that was itself reversed doesn't count as
  // money received, so an invoice paid-then-reversed becomes voidable again.
  const received = inv.payments.reduce((t, p) => t + p.amount, 0);
  if (received > 0.001) {
    return NextResponse.json(
      {
        error: "HAS_PAYMENTS",
        received,
        message:
          `₹${received.toLocaleString("en-IN")} has been received against this invoice, so it can't be voided. ` +
          `Issue a credit note to cancel what's owed, or reverse the payment first if it was recorded in error.`,
      },
      { status: 409 },
    );
  }

  const updated = await prisma.invoice.update({
    where: { id: inv.id },
    data: {
      status: "void",
      voidedAt: new Date(),
      voidedByUserId: session.userId,
      voidReason: parsed.data.reason,
    },
  });

  await audit({
    userId: session.userId,
    action: "invoice.void",
    tableName: "invoice",
    rowId: inv.id,
    before: { status: inv.status, amount: inv.amount, gstAmount: inv.gstAmount, kind: inv.kind },
    after: { status: "void", reason: parsed.data.reason },
  });

  return NextResponse.json({ ok: true, status: updated.status, voidedAt: updated.voidedAt });
}
