// Printable Purchase Order view. Only renderable for fully-approved
// requisitions — no point sending a vendor a PO that's still pending.
//
// Design: a single self-contained page with print-friendly CSS. The user
// hits Cmd+P (or the on-page button) and saves as PDF / sends to the
// vendor. No PDF library dep, no server-side rendering pipeline — just
// HTML the browser knows how to print.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { formatDate } from "@/lib/utils";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

type Item = { name: string; qty: number; unit?: string; estimatedUnitCost: number; notes?: string };

export default async function RequisitionPOPage({ params }: { params: { id: string } }) {
  const session = await requireSession();
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");

  const req = await prisma.requisition.findUnique({
    where: { id: params.id },
    include: {
      requestedBy: { select: { name: true, email: true } },
      centre: {
        select: {
          name: true,
          address: true,
          gstNo: true,
          org: { select: { name: true } },
        },
      },
    },
  });
  if (!req) notFound();
  if (centreId && req.centreId !== centreId) notFound();
  // Org ownership guard: an HQ user (centreId=null) could otherwise open any
  // org's requisition by id. Bind the row's org to the session's org.
  if ((await getOrgIdForCentre(req.centreId)) !== orgId) notFound();
  if (req.stage !== "approved") redirect(`/requisitions`);

  // itemsJson is a jsonb column — Prisma returns the parsed array directly.
  const items = (Array.isArray(req.itemsJson) ? req.itemsJson : []) as Item[];
  const poNumber = `EW-PO-${req.id.slice(-6).toUpperCase()}`;
  const issueDate = req.accountantDecidedAt ?? req.updatedAt;

  return (
    <div className="po-page mx-auto max-w-3xl bg-white p-8 text-sm text-black print:max-w-none print:p-6">
      {/* Print-only style block: hide screen-only sidebar/topbar via @media print. */}
      <style>{`
        @media print {
          /* hide everything that isn't this PO sheet */
          aside, header, nav, button, .no-print { display: none !important; }
          body, main { background: white !important; padding: 0 !important; }
          .po-page { padding: 0 !important; max-width: 100% !important; }
        }
      `}</style>

      {/* On-screen toolbar — hidden on print */}
      <div className="no-print mb-6 flex items-center justify-between border-b pb-3">
        <Link href="/requisitions" className="text-xs text-primary underline">
          ← Back to requisitions
        </Link>
        {/* Client component, like every other print view (certificates,
            invoices, SaaS invoices). A Server Component cannot pass an
            onClick at all — React refuses to serialise the function prop and
            the whole page renders blank with a 200, which is what the
            previous inline-script workaround actually did in production. */}
        <PrintButton />
      </div>

      {/* Header band — vendor-facing letterhead */}
      <div className="mb-6 flex items-start justify-between border-b-2 border-black pb-4">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wide">Purchase Order</h1>
          <div className="mt-1 font-mono text-sm">#{poNumber}</div>
        </div>
        <div className="text-right">
          <div className="font-semibold">{req.centre.org?.name ?? "Equiwings"}</div>
          <div className="text-xs">{req.centre.name}</div>
          {req.centre.address && <div className="text-xs">{req.centre.address}</div>}
          {req.centre.gstNo && <div className="mt-1 font-mono text-[10px]">GSTIN: {req.centre.gstNo}</div>}
        </div>
      </div>

      {/* Meta grid */}
      <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <div>
          <div className="font-semibold uppercase tracking-wide text-gray-600">PO date</div>
          <div>{formatDate(issueDate)}</div>
        </div>
        <div>
          <div className="font-semibold uppercase tracking-wide text-gray-600">Requested by</div>
          <div>{req.requestedBy.name}</div>
        </div>
        <div className="col-span-2">
          <div className="font-semibold uppercase tracking-wide text-gray-600">Reason</div>
          <div>{req.reason ?? "—"}</div>
        </div>
      </div>

      {/* Line items */}
      <div className="overflow-x-auto">
        <table className="mb-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="px-2 py-1.5">#</th>
              <th className="px-2 py-1.5">Item</th>
              <th className="px-2 py-1.5 text-right">Qty</th>
              <th className="px-2 py-1.5">Unit</th>
              <th className="px-2 py-1.5 text-right">Unit Cost</th>
              <th className="px-2 py-1.5 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const line = it.qty * it.estimatedUnitCost;
              return (
                <tr key={i} className="border-b">
                  <td className="px-2 py-1.5">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    {it.name}
                    {it.notes && <div className="text-[10px] text-gray-500">{it.notes}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{it.qty}</td>
                  <td className="px-2 py-1.5">{it.unit ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono">₹{it.estimatedUnitCost.toLocaleString("en-IN")}</td>
                  <td className="px-2 py-1.5 text-right font-mono">₹{line.toLocaleString("en-IN")}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black">
              <td colSpan={5} className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide">
                Estimated total
              </td>
              <td className="px-2 py-1.5 text-right font-mono font-bold">
                ₹{Math.round(req.totalEstimatedCost).toLocaleString("en-IN")}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Approval trail */}
      <div className="mb-6 grid grid-cols-2 gap-6 text-xs">
        <div className="rounded border p-3">
          <div className="font-semibold uppercase tracking-wide text-gray-600">Manager approval</div>
          <div className="mt-1">
            {req.managerDecidedByUserId && req.managerDecidedAt
              ? `Approved on ${formatDate(req.managerDecidedAt)}`
              : "—"}
          </div>
          {req.managerNotes && <div className="mt-1 italic">"{req.managerNotes}"</div>}
        </div>
        <div className="rounded border p-3">
          <div className="font-semibold uppercase tracking-wide text-gray-600">Accountant sign-off</div>
          <div className="mt-1">
            {req.accountantDecidedByUserId && req.accountantDecidedAt
              ? `Signed off on ${formatDate(req.accountantDecidedAt)}`
              : "—"}
          </div>
          {req.accountantNotes && <div className="mt-1 italic">"{req.accountantNotes}"</div>}
        </div>
      </div>

      {/* Footer band */}
      <div className="border-t pt-4 text-[10px] text-gray-500">
        This PO authorises the supplier to fulfil the items above at the listed estimated unit costs. Invoices must reference PO #{poNumber} and quote {req.centre.gstNo ?? "buyer GSTIN"} for GST credit.
      </div>
    </div>
  );
}
