// Platform-to-tenant invoice helpers. The flow:
//   1. Stripe/Razorpay webhook says "subscription paid for org X for period Y".
//   2. We call issueSaasInvoice() which atomically bumps the invoice counter
//      and writes a SaasInvoice row.
//   3. A PDF can be generated later from the row; we keep generation
//      lazy because most tenants only need the soft copy at year-end.
//
// GST math: Indian SaaS sold in INR is taxed at 18% standard. When the
// tenant's billing state matches our state, we'd split into CGST 9% +
// SGST 9%; otherwise IGST 18% applies. For the platform's purposes we
// store one combined `taxAmount` + `taxBps`; the printed PDF can split
// at render time using PlatformBillingConfig.state vs org.billingState.

import { prisma } from "./prisma";

export type IssueSaasInvoiceInput = {
  orgId: string;
  plan: "starter" | "pro" | "enterprise";
  periodStart: Date;
  periodEnd: Date;
  // Subtotal in INR rupees (before tax). Caller decides — typically the
  // plan's monthly price × period months.
  subtotal: number;
  // External payment id from Stripe/Razorpay so the invoice can be cross-referenced.
  externalRef?: string | null;
};

export async function issueSaasInvoice(input: IssueSaasInvoiceInput): Promise<{ id: string; number: string }> {
  // Pull the platform config + org snapshot in one round-trip; both rarely
  // change so a few seconds of staleness is acceptable.
  const [cfg, org] = await Promise.all([
    prisma.platformBillingConfig.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
    prisma.organisation.findUnique({
      where: { id: input.orgId },
      select: { name: true, billingEmail: true, billingGstin: true, billingState: true },
    }),
  ]);
  if (!org) throw new Error("ORG_NOT_FOUND");

  const taxBps = cfg.defaultTaxBps; // 1800 = 18%
  const taxAmount = Math.round((input.subtotal * taxBps) / 10000);
  const total = input.subtotal + taxAmount;

  // Atomically bump the counter + format the invoice number. We do this in
  // a transaction so two concurrent dispatches can't collide on the same
  // sequence. The format is PREFIX-YYYY-NNNNNN.
  const year = input.periodEnd.getFullYear();
  const invoice = await prisma.$transaction(async (tx) => {
    const bumped = await tx.platformBillingConfig.update({
      where: { id: "default" },
      data: { invoiceCounter: { increment: 1 } },
      select: { invoiceCounter: true, invoicePrefix: true },
    });
    const number = `${bumped.invoicePrefix}-${year}-${String(bumped.invoiceCounter).padStart(6, "0")}`;
    return tx.saasInvoice.create({
      data: {
        orgId: input.orgId,
        number,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        plan: input.plan,
        description: `${input.plan} plan · ${input.periodStart.toISOString().slice(0, 10)} → ${input.periodEnd.toISOString().slice(0, 10)}`,
        subtotal: input.subtotal,
        taxBps,
        taxAmount,
        total,
        currency: "INR",
        billingName: org.name,
        billingGstin: org.billingGstin ?? null,
        billingEmail: org.billingEmail ?? null,
        billingState: org.billingState ?? null,
        externalRef: input.externalRef ?? null,
      },
      select: { id: true, number: true },
    });
  });

  return invoice;
}

// Mark a SaaS invoice paid after webhook confirmation. Idempotent — a
// re-delivered webhook won't double-mark.
export async function markSaasInvoicePaid(invoiceId: string, externalRef: string | null) {
  await prisma.saasInvoice.updateMany({
    where: { id: invoiceId, status: "due" },
    data: { status: "paid", paidAt: new Date(), externalRef },
  });
}
