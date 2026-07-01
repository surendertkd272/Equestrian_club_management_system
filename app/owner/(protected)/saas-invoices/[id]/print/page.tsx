import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { redirect } from "next/navigation";
import { PrintButton } from "./print-button";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

// Print-friendly SaaS invoice view. Owner opens this from the invoice
// list and uses the browser's "Save as PDF" (Ctrl/Cmd+P → Save). No
// PDF library dependency — browsers reliably produce the PDF that
// Indian customers' accountants accept.
//
// GST treatment: when our state matches the customer's state we split
// into CGST + SGST; otherwise IGST. That's the only Indian tax detail
// that matters at this layer; the actual rate (18% by default) comes
// from PlatformBillingConfig.defaultTaxBps captured at issue time.

export default async function SaasInvoicePrintPage({ params }: { params: { id: string } }) {
  const session = await getOwnerSession();
  if (!session) redirect("/owner/login");

  const [invoice, cfg] = await Promise.all([
    prisma.saasInvoice.findUnique({
      where: { id: params.id },
      include: { org: { select: { name: true } } },
    }),
    prisma.platformBillingConfig.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
  ]);
  if (!invoice) notFound();

  const sameState = !!cfg.state && !!invoice.billingState && cfg.state.toLowerCase().trim() === invoice.billingState.toLowerCase().trim();
  const halfTaxBps = Math.round(invoice.taxBps / 2);
  const halfTaxAmount = Math.round(invoice.taxAmount / 2);

  return (
    <main className="mx-auto max-w-3xl bg-white p-12 text-sm text-foreground print:p-8">
      <style>{`@media print { body { background:#fff } header,nav,footer { display:none } .no-print { display:none } }`}</style>

      {/* Header */}
      <div className="flex items-start justify-between border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold">{cfg.legalName}</h1>
          {(cfg.addressLine1 || cfg.city) && (
            <div className="mt-1 text-xs text-muted-foreground">
              {[cfg.addressLine1, cfg.addressLine2, [cfg.city, cfg.state, cfg.pincode].filter(Boolean).join(", "), cfg.country].filter(Boolean).join(" · ")}
            </div>
          )}
          {cfg.gstin && <div className="mt-1 text-xs">GSTIN: <strong>{cfg.gstin}</strong></div>}
          {cfg.panNo && <div className="text-xs">PAN: <strong>{cfg.panNo}</strong></div>}
          {cfg.supportEmail && <div className="text-xs">{cfg.supportEmail}</div>}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Tax invoice</div>
          <div className="mt-1 font-mono text-lg">{invoice.number}</div>
          <div className="mt-2 text-xs text-muted-foreground">Issued {new Date(invoice.issuedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
          {invoice.paidAt && <div className="text-xs text-emerald-700">Paid {new Date(invoice.paidAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>}
        </div>
      </div>

      {/* Bill to */}
      <div className="mt-6 grid grid-cols-2 gap-6">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bill to</div>
          <div className="mt-1 font-medium">{invoice.billingName ?? invoice.org.name}</div>
          {invoice.billingGstin && <div className="text-xs">GSTIN: {invoice.billingGstin}</div>}
          {invoice.billingState && <div className="text-xs">{invoice.billingState}</div>}
          {invoice.billingEmail && <div className="text-xs text-muted-foreground">{invoice.billingEmail}</div>}
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Billing period</div>
          <div className="mt-1 text-sm">
            {new Date(invoice.periodStart).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            {" → "}
            {new Date(invoice.periodEnd).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</div>
          <div className="mt-1 text-sm capitalize">{formatEnum(invoice.status)}</div>
        </div>
      </div>

      {/* Line items */}
      <table className="mt-8 w-full text-sm">
        <thead className="border-b text-left text-xs tracking-wider text-muted-foreground">
          <tr>
            <th className="pb-2">Description</th>
            <th className="pb-2 text-center">HSN/SAC</th>
            <th className="pb-2 text-right">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="py-3">
              <div className="font-medium">{invoice.description}</div>
              <div className="text-xs text-muted-foreground">Equiwings SaaS subscription · {invoice.plan} plan</div>
            </td>
            <td className="py-3 text-center text-xs">{cfg.hsnCode ?? "—"}</td>
            <td className="py-3 text-right font-medium">₹{invoice.subtotal.toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <table className="text-sm">
          <tbody>
            <tr>
              <td className="py-1 pr-8 text-right text-muted-foreground">Subtotal</td>
              <td className="py-1 text-right font-medium">₹{invoice.subtotal.toLocaleString("en-IN")}</td>
            </tr>
            {sameState ? (
              <>
                <tr>
                  <td className="py-1 pr-8 text-right text-muted-foreground">CGST @ {(halfTaxBps / 100).toFixed(2)}%</td>
                  <td className="py-1 text-right">₹{halfTaxAmount.toLocaleString("en-IN")}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-8 text-right text-muted-foreground">SGST @ {(halfTaxBps / 100).toFixed(2)}%</td>
                  <td className="py-1 text-right">₹{halfTaxAmount.toLocaleString("en-IN")}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td className="py-1 pr-8 text-right text-muted-foreground">IGST @ {(invoice.taxBps / 100).toFixed(2)}%</td>
                <td className="py-1 text-right">₹{invoice.taxAmount.toLocaleString("en-IN")}</td>
              </tr>
            )}
            <tr className="border-t">
              <td className="py-2 pr-8 text-right font-semibold">Total ({invoice.currency})</td>
              <td className="py-2 text-right text-lg font-bold">₹{invoice.total.toLocaleString("en-IN")}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="mt-12 border-t pt-4 text-xs text-muted-foreground">
        <p>
          {sameState
            ? "Tax payable on reverse charge: No. Intra-state supply — CGST + SGST split."
            : "Inter-state supply — IGST applicable."}
          {" "}This is a system-generated invoice; no signature required.
        </p>
        {invoice.externalRef && (
          <p className="mt-2">Payment reference: <span className="font-mono">{invoice.externalRef}</span></p>
        )}
      </div>

      <div className="no-print mt-8 flex justify-end gap-2">
        <PrintButton />
      </div>
    </main>
  );
}
