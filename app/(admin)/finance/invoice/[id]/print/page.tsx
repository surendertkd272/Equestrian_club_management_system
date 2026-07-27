import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { PrintButton } from "./print-button";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

// Tenant-side invoice print view — riders/parents print their fee
// invoices to forward to accountants. Same Print → Save as PDF flow as
// the SaaS-side invoice page; no library dep.
export default async function TenantInvoicePrintPage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      centre: { select: { name: true, gstNo: true, address: true, org: { select: { name: true } } } },
      rider: { select: { firstName: true, lastName: true, email: true, mobile: true } },
      payments: { orderBy: { paidAt: "asc" } },
      creditNotes: { select: { amount: true, gstAmount: true, createdAt: true } },
    },
  });
  if (!invoice) notFound();
  if (session.role !== "SUPER_ADMIN" && invoice.centreId !== session.centreId) notFound();

  const paidTotal = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  // A credit note is a negative Invoice row. Printed as-is it came out as a tax
  // invoice with a negative total, and the GST line vanished (it was gated on
  // gst > 0), so Subtotal and Total disagreed by the hidden tax.
  const isCreditNote = !!invoice.creditNoteForId;
  const voided = !!invoice.voidedAt;
  // Credits already issued against this invoice reduce what is owed. Without
  // this the document handed to a family bills them for a charge the club has
  // partly cancelled.
  const credited = invoice.creditNotes.reduce((t, c) => t + Math.abs(c.amount + c.gstAmount), 0);
  const subtotal = Math.abs(invoice.amount);
  const gst = Math.abs(invoice.gstAmount);
  const total = subtotal + gst;
  const balance = isCreditNote || voided ? 0 : Math.max(0, total - credited - paidTotal);

  return (
    <main className="mx-auto max-w-3xl bg-white p-12 text-sm text-slate-900 print:p-8">
      <style>{`@media print { body { background:#fff } header,nav,footer,.no-print { display:none !important } }`}</style>

      {voided && (
        <div className="mb-6 rounded border-4 border-rose-600 p-4 text-center">
          <div className="text-2xl font-black uppercase tracking-widest text-rose-700">Void — not payable</div>
          {invoice.voidReason && <div className="mt-1 text-xs text-rose-700">{invoice.voidReason}</div>}
        </div>
      )}
      {isCreditNote && (
        <div className="mb-6 rounded border-2 border-slate-800 p-3 text-center">
          <div className="text-lg font-bold uppercase tracking-wide">Credit Note</div>
          <div className="text-xs text-slate-600">
            Against invoice #{invoice.creditNoteForId?.slice(-8).toUpperCase()} — this cancels a charge; nothing is
            payable on this document.
          </div>
        </div>
      )}

      <div className="flex items-start justify-between border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold">{invoice.centre.name}</h1>
          <div className="text-xs text-slate-500">{invoice.centre.org.name}</div>
          {invoice.centre.address && <div className="mt-1 text-xs text-slate-600">{invoice.centre.address}</div>}
          {invoice.centre.gstNo && <div className="mt-1 text-xs">GSTIN: <strong>{invoice.centre.gstNo}</strong></div>}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-slate-500">Invoice</div>
          <div className="mt-1 font-mono">{invoice.id.slice(-12).toUpperCase()}</div>
          <div className="mt-2 text-xs text-slate-600">Issued {new Date(invoice.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
          <div className="text-xs text-slate-600">Due {new Date(invoice.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
        </div>
      </div>

      <div className="mt-6">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Bill to</div>
        <div className="mt-1 font-medium">{invoice.rider.firstName} {invoice.rider.lastName}</div>
        {invoice.rider.email && <div className="text-xs text-slate-600">{invoice.rider.email}</div>}
        <div className="text-xs text-slate-600">{invoice.rider.mobile}</div>
      </div>

      <table className="mt-8 w-full text-sm">
        <thead className="border-b text-left text-xs tracking-wider text-slate-500">
          <tr>
            <th className="pb-2">Description</th>
            <th className="pb-2 text-right">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="py-3">
              <div className="font-medium capitalize">{formatEnum(invoice.kind)} fee</div>
            </td>
            <td className="py-3 text-right font-medium">₹{subtotal.toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <table className="text-sm">
          <tbody>
            <tr>
              <td className="py-1 pr-8 text-right text-slate-600">Subtotal</td>
              <td className="py-1 text-right">₹{subtotal.toLocaleString("en-IN")}</td>
            </tr>
            {gst !== 0 && (
              <tr>
                <td className="py-1 pr-8 text-right text-slate-600">GST</td>
                <td className="py-1 text-right">₹{gst.toLocaleString("en-IN")}</td>
              </tr>
            )}
            {credited > 0.001 && (
              <tr>
                <td className="py-1 pr-8 text-right text-slate-600">Less credited</td>
                <td className="py-1 text-right">−₹{Math.round(credited).toLocaleString("en-IN")}</td>
              </tr>
            )}
            <tr className="border-t">
              <td className="py-2 pr-8 text-right font-semibold">Total</td>
              <td className="py-2 text-right text-lg font-bold">₹{total.toLocaleString("en-IN")}</td>
            </tr>
            {paidTotal !== 0 && (
              <tr>
                <td className="py-1 pr-8 text-right text-slate-600">Paid</td>
                <td className="py-1 text-right text-emerald-700">−₹{paidTotal.toLocaleString("en-IN")}</td>
              </tr>
            )}
            <tr className="border-t">
              <td className="py-2 pr-8 text-right font-semibold">Balance</td>
              <td className={`py-2 text-right text-lg font-bold ${balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                ₹{balance.toLocaleString("en-IN")}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {invoice.payments.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Payment history</div>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {invoice.payments.map((p) => (
              <li key={p.id}>
                {p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                {" · "}
                <span className="capitalize">{formatEnum(p.method)}</span>
                {" · "}
                ₹{p.amount.toLocaleString("en-IN")}
                {p.txnRef && <span className="text-slate-400"> · {p.txnRef.slice(-10)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-12 border-t pt-4 text-xs text-slate-500">
        <p>This is a system-generated invoice; no signature required.</p>
      </div>

      <div className="no-print mt-8 flex justify-end">
        <PrintButton />
      </div>
    </main>
  );
}
