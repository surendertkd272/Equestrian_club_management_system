import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { creditPosition } from "@/lib/credit-note";
import { requireSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { RecordPaymentButton } from "@/components/finance/record-payment-button";
import { InvoiceReversalActions, ReversePaymentButton } from "@/components/finance/reversal-actions";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

// Per-rider statement of account. Aggregates every invoice + payment for
// the rider so a parent / centre manager can see "you owe ₹X total" in one
// place. Each payment links back to its invoice; orphan payments (manual
// entries) would surface here too once we wire that flow.
function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default async function RiderStatement({ params }: { params: { riderId: string } }) {
  const session = await requireSession();
  if (!can(session.role, "finance.read")) {
    return notFound();
  }
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) notFound();

  const rider = await prisma.rider.findUnique({
    where: { id: params.riderId },
    include: { centre: { select: { name: true } } },
  });
  if (!rider) notFound();
  // Centre-scoped users are pinned to their own centre; HQ users (centreId=null)
  // are still bounded to their own org so they can't open another org's rider by id.
  if (centreId && rider.centreId !== centreId) notFound();
  if ((await getOrgIdForCentre(rider.centreId)) !== orgId) notFound();

  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { riderId: rider.id },
      include: { payments: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.payment.findMany({
      where: { invoice: { riderId: rider.id } },
      orderBy: { paidAt: "desc" },
    }),
  ]);

  // Voided invoices are cancelled charges — counting them here made VOIDING a
  // charge look like it INCREASED what the family owed. Credit notes are
  // negative rows against a live invoice, so they belong in the net but not as
  // charges of their own.
  const liveInvoices = invoices.filter((i) => !i.voidedAt && !i.creditNoteForId);
  const creditsByInvoice = new Map<string, { amount: number; gstAmount: number }[]>();
  for (const i of invoices) {
    if (!i.creditNoteForId || i.voidedAt) continue;
    const list = creditsByInvoice.get(i.creditNoteForId) ?? [];
    list.push({ amount: i.amount, gstAmount: i.gstAmount });
    creditsByInvoice.set(i.creditNoteForId, list);
  }
  const paymentsByInvoice = new Map<string, { amount: number }[]>();
  for (const p of payments) {
    const list = paymentsByInvoice.get(p.invoiceId) ?? [];
    list.push({ amount: p.amount });
    paymentsByInvoice.set(p.invoiceId, list);
  }
  // Which receipts have already been undone, so the row doesn't offer it twice.
  const reversedPaymentIds = new Set(
    payments.map((p) => p.reversalOfId).filter((id): id is string => !!id),
  );
  const positions = liveInvoices.map((i) =>
    creditPosition({
      amount: i.amount,
      gstAmount: i.gstAmount,
      payments: paymentsByInvoice.get(i.id) ?? [],
      creditNotes: creditsByInvoice.get(i.id) ?? [],
    }),
  );
  // What was actually charged, net of anything credited back.
  const totalInvoiced = positions.reduce((s, pos) => s + pos.creditable, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const balance = totalInvoiced - totalPaid;
  // Sum the real per-invoice shortfalls, not the face value of "due" rows —
  // the old figure ignored part payments and ignored the GST line entirely.
  const outstanding = positions.reduce((s, pos) => s + pos.outstanding, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/finance">
            <ChevronLeft className="h-4 w-4" /> Back to finance
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {rider.firstName} {rider.lastName} · statement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
            <dt className="text-muted-foreground">Centre</dt>
            <dd>{rider.centre.name}</dd>
            <dt className="text-muted-foreground">Invoiced (lifetime)</dt>
            <dd className="font-mono">{inr(totalInvoiced)}</dd>
            <dt className="text-muted-foreground">Paid (lifetime)</dt>
            <dd className="font-mono">{inr(totalPaid)}</dd>
            <dt className="text-muted-foreground">Balance</dt>
            <dd className={`font-mono font-semibold ${balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
              {inr(balance)}
            </dd>
            <dt className="text-muted-foreground">Outstanding (due-status)</dt>
            <dd className="font-mono">{inr(outstanding)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices ({invoices.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Kind</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">GST</th>
                  <th className="pb-2">Paid Via</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const paidSum = inv.payments.reduce((s, p) => s + p.amount, 0);
                  const pos = creditPosition({
                    amount: inv.amount,
                    gstAmount: inv.gstAmount,
                    payments: inv.payments.map((p) => ({ amount: p.amount })),
                    creditNotes: creditsByInvoice.get(inv.id) ?? [],
                  });
                  const outstandingForInv = pos.outstanding;
                  const isCredit = !!inv.creditNoteForId;
                  return (
                    <tr key={inv.id} className={`border-t ${inv.voidedAt ? "opacity-60" : ""}`}>
                      <td className="py-2">{formatDate(inv.createdAt)}</td>
                      <td className="py-2">
                        {isCredit ? "Credit note" : formatEnum(inv.kind)}
                        {inv.voidedAt && (
                          <span className="ml-2 text-[11px] uppercase tracking-wide text-rose-600">void</span>
                        )}
                      </td>
                      <td className="py-2 font-mono">{inr(inv.amount)}</td>
                      <td className="py-2 font-mono">{inr(inv.gstAmount)}</td>
                      <td className="py-2 text-xs">
                        {inv.payments.length > 0
                          ? inv.payments
                              .map((p) => `${p.method}${p.txnRef ? ` · ${p.txnRef}` : ""}`)
                              .join(", ")
                          : "—"}
                      </td>
                      <td className="py-2">
                        <Badge
                          variant={
                            inv.status === "paid" ? "success" : inv.status === "due" ? "warning" : "destructive"
                          }
                        >
                          {formatEnum(inv.status)}
                        </Badge>
                      </td>
                      <td className="py-2">
                        {can(session.role, "finance.write") && (
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {!inv.voidedAt && !isCredit && outstandingForInv > 0 && (
                              <RecordPaymentButton invoiceId={inv.id} outstanding={outstandingForInv} />
                            )}
                            <InvoiceReversalActions
                              invoiceId={inv.id}
                              outstanding={outstandingForInv}
                              received={paidSum}
                              voided={!!inv.voidedAt}
                              isCreditNote={isCredit}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No invoices for this rider yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments ({payments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 border-b py-1 last:border-0">
                  <span>
                    {formatDate(p.paidAt)} · {formatEnum(p.method)}
                    {p.txnRef && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.txnRef}</span>}
                    {p.amount < 0 && (
                      <span className="ml-2 text-[11px] uppercase tracking-wide text-rose-600">
                        reversal{p.reason ? ` · ${p.reason}` : ""}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{inr(p.amount)}</span>
                    {can(session.role, "finance.write") && (
                      <ReversePaymentButton
                        paymentId={p.id}
                        amount={p.amount}
                        alreadyReversed={reversedPaymentIds.has(p.id)}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
