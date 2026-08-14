import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { issueSaasInvoice } from "../saas-billing";
import { notifyOwner, esc } from "../notify-owner";
import { SweepResult, SweepOpts } from "./shared";

// Monthly SaaS invoicing.
//
// issueSaasInvoice() was complete — atomic numbering, GST maths, frozen billing
// snapshot, a GST-compliant print template — but it was only ever called from
// the Stripe and Razorpay webhooks. No SaaS payment has ever flowed through
// either (no Razorpay plan ids are configured), so no invoice has ever existed.
// Money arriving by bank transfer or UPI produced no document at all.
//
// Invoicing is deliberately decoupled from collection here. A tax invoice is
// owed for a period of service regardless of how — or whether — payment
// arrived; tying its existence to a successful card charge is what left three
// months of revenue undocumented.
//
// Runs on the 1st, billing the calendar month that just ended, unless forced.
export async function sweepSaasBillingRun(opts?: SweepOpts): Promise<SweepResult> {
  const now = new Date();
  const details: string[] = [];
  let scanned = 0;
  let notified = 0;
  let skipped = 0;

  if (now.getDate() !== 1 && !opts?.force) {
    return { job: "saas_billing_run", scanned: 0, notified: 0, skipped: 0, details: { reason: "not_first_of_month" } };
  }

  // The calendar month that just ended, in UTC. Period boundaries must be
  // stable — periodStart is half of the uniqueness key, so deriving it from
  // anything drifting (local time, "30 days ago") would let the same month be
  // billed twice under two slightly different starts.
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);

  // Billable = live customers. Trials owe nothing yet; suspended orgs are
  // read-only and continuing to invoice them would be indefensible. past_due
  // stays billable: they used the service that month and still owe for it.
  const orgs = await prisma.organisation.findMany({
    where: { status: { in: ["active", "past_due"] } },
    select: { id: true, name: true, plan: true, billingEmail: true },
  });
  scanned = orgs.length;

  const pricing = await prisma.platformPricing.findMany({
    select: { key: true, monthlyInr: true },
  });
  const priceByPlan = new Map(pricing.map((p) => [p.key, p.monthlyInr]));

  const issued: { name: string; number: string; total: number }[] = [];

  for (const org of orgs) {
    try {
      const subtotal = priceByPlan.get(org.plan);
      if (subtotal == null) {
        // A plan with no price is a configuration error, not a free customer —
        // say so rather than silently issuing a zero-rupee invoice.
        details.push(`no price for plan "${org.plan}": ${org.name}`);
        skipped++;
        continue;
      }

      const invoice = await issueSaasInvoice({
        orgId: org.id,
        plan: org.plan as "starter" | "pro" | "enterprise",
        periodStart,
        periodEnd,
        subtotal,
      });
      issued.push({ name: org.name, number: invoice.number, total: subtotal });
      details.push(`issued ${invoice.number}: ${org.name}`);
    } catch (err) {
      // P2002 = the unique (orgId, periodStart) index caught a re-run. That is
      // the guard working, not a failure.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        skipped++;
        continue;
      }
      console.error("[saas_billing_run] failed for org", { orgId: org.id, err });
      details.push(`FAILED: ${org.name}`);
    }
  }

  // One digest, not one email per invoice: this is a monthly summary the owner
  // acts on in a single sitting, and collection is manual for now.
  if (issued.length > 0) {
    const rows = issued
      .map((i) => `<li>${esc(i.name)} — <strong>${esc(i.number)}</strong> · ₹${i.total.toLocaleString("en-IN")} + GST</li>`)
      .join("");
    const gross = issued.reduce((sum, i) => sum + i.total, 0);
    const ok = await notifyOwner({
      subject: `${issued.length} SaaS invoice${issued.length === 1 ? "" : "s"} issued — ${periodStart.toISOString().slice(0, 7)}`,
      heading: "Monthly invoices issued",
      body: `<p>Invoices for <strong>${periodStart.toISOString().slice(0, 10)} → ${periodEnd
        .toISOString()
        .slice(0, 10)}</strong>:</p>
<ul>${rows}</ul>
<p>Subtotal across all invoices: <strong>₹${gross.toLocaleString("en-IN")}</strong> before GST.</p>
<p>These are marked <strong>due</strong>. Nothing is collected automatically — record payment
from the invoice list once it arrives.</p>`,
      ref: { type: "owner.saas_billing_run", rowId: periodStart.toISOString().slice(0, 10) },
    });
    if (ok) notified++;
  }

  return {
    job: "saas_billing_run",
    scanned,
    notified,
    skipped,
    details: { period: periodStart.toISOString().slice(0, 10), issued: issued.length, transitions: details },
  };
}
