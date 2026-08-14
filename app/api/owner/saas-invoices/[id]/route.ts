import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession, isOwnerAdmin } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";

// PATCH /api/owner/saas-invoices/[id] — record the outcome of an invoice.
//
// Collection is deliberately manual: payment arrives by bank transfer or UPI,
// outside the app entirely. Without this the monthly run would issue invoices
// that sit "due" forever, and the "Paid · last 30d" figure on the owner
// dashboard would always read zero — a number that is wrong is worse than one
// that is missing.
//
// Only two transitions are offered, both reversible-by-correction rather than
// destructive: due → paid (money arrived) and due → void (issued in error).
// Nothing here deletes an invoice: a tax document that existed must stay
// auditable, which is also why "void" is a status rather than a delete.
const schema = z.object({
  status: z.enum(["paid", "void"]),
  /** Bank/UPI reference, so the row can be reconciled against a statement. */
  reference: z.string().max(120).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED_OWNER" }, { status: 401 });
  // Money state is an OWNER_ADMIN action — an editor or billing-viewer role
  // should not be able to mark revenue received.
  if (!isOwnerAdmin(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const invoice = await prisma.saasInvoice.findUnique({
    where: { id: params.id },
    select: { id: true, number: true, status: true, total: true, orgId: true, externalRef: true },
  });
  if (!invoice) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Only a "due" invoice can move. Re-marking a paid invoice, or reviving a
  // voided one, needs a deliberate correction rather than a second click.
  if (invoice.status !== "due") {
    return NextResponse.json(
      { error: "ALREADY_DECIDED", status: invoice.status },
      { status: 409 },
    );
  }

  const updated = await prisma.saasInvoice.update({
    where: { id: invoice.id },
    data: {
      status: parsed.data.status,
      paidAt: parsed.data.status === "paid" ? new Date() : null,
      externalRef: parsed.data.reference?.trim() || invoice.externalRef,
    },
    select: { id: true, number: true, status: true, paidAt: true },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: parsed.data.status === "paid" ? "owner.saas_invoice_paid" : "owner.saas_invoice_voided",
    orgId: invoice.orgId,
    after: {
      number: invoice.number,
      total: invoice.total,
      reference: parsed.data.reference ?? null,
    },
  });

  return NextResponse.json({ ok: true, invoice: updated });
}
