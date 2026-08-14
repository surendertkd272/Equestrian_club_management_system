import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertRoute } from "@/lib/route-guard";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession, getFeaturesForSession } from "@/lib/features-gate";
import { startOfTodayForCentre } from "@/lib/centre-tz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { ExportCsvButton } from "@/components/ui/export-csv";
import { StatTile } from "@/components/ui/stat-tile";
import { Plus, TrendingUp, TrendingDown, IndianRupee, Receipt } from "lucide-react";
import { can } from "@/lib/permissions";
import { BulkMarkPaid } from "./bulk-mark-paid";
import { RecordPaymentButton } from "@/components/finance/record-payment-button";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

// Finance dashboard — income, expenses, P&L. Data sources:
//   • Income     → Payment.amount summed across the period (Razorpay
//                  webhook + cash entries via the payments API)
//   • Receivable → Invoice.amount where status != paid (outstanding)
//   • Expenses   → Expense.amount summed over the period
//   • Overdue    → Invoice with dueDate < now and status = due
// Period defaults to "this month" but a future iteration would let the
// user pick custom date ranges.

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default async function FinancePage() {
  // Finance module removed from the admin surface (sidebar link + dashboard
  // cards are gone). This unconditional guard blocks direct URL access too.
  // The page code is kept (not deleted) so the module is reversible — drop this
  // line and re-add the sidebar entry to bring it back. NOTE: because /finance
  // no longer appears in the NAV table, assertRoute() below would otherwise
  // treat it as unrestricted, so this redirect is what actually gates the page.
  redirect("/dashboard");
  const session = await assertRoute("/finance");
  // Finance pages expose receivables, P&L, payment ledgers — admin/accountant
  // only. The sidebar already hides this link from other roles, but a direct
  // URL hit would otherwise render it.
  if (!can(session.role, "finance.read")) redirect("/dashboard");
  // fee-collection decides whether this club bills riders at all.
  //
  // It used to gate only parent-FACING surfaces, on the reasoning that staff
  // might still log offline payments. But a club that has the switch off never
  // raises a rider invoice, so every receivable figure here is structurally
  // zero: "Outstanding ₹0 · 0 invoices · 0 overdue" is not neutral, it reads
  // as a system that is broken or unconfigured. The expense/P&L half is
  // governed by its own `expenses` flag and stays regardless.
  const feesOn = (await getFeaturesForSession(session)).has("fee-collection");
  const centreId = scopeCentre(session);
  // HQ users (SUPER_ADMIN/ADMIN) have centreId=null → "all centres". Bind to
  // their org so the "all" filter stays org-scoped instead of leaking every
  // org's invoices/expenses. Fail closed if the org can't be resolved.
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  const where = tenantWhere(centreId, orgId);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  // An invoice is "overdue" once its due *day* has passed in the centre's local
  // zone — not the moment the server's UTC clock crosses the stored due instant.
  const todayStart = await startOfTodayForCentre(centreId);

  const [
    paidThisMonth,
    paidYear,
    expensesThisMonth,
    expensesYear,
    outstanding,
    overdueCount,
    invoices,
    recentExpenses,
    expenseByCategory,
    upcomingDue,
  ] = await Promise.all([
    prisma.payment.aggregate({
      where: { invoice: { ...where }, paidAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { invoice: { ...where }, paidAt: { gte: yearStart } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { ...where, spentAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { ...where, spentAt: { gte: yearStart } },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: { ...where, status: "due" },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.invoice.count({ where: { ...where, status: "due", dueDate: { lt: todayStart } } }),
    prisma.invoice.findMany({
      where,
      include: { rider: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.expense.findMany({
      where,
      include: { category: { select: { name: true } }, vendor: { select: { name: true } } },
      orderBy: { spentAt: "desc" },
      take: 25,
    }),
    // Per-category breakdown for the current year — used by the "where the
    // money goes" panel.
    prisma.expense.groupBy({
      by: ["categoryId"],
      where: { ...where, spentAt: { gte: yearStart } },
      _sum: { amount: true },
    }),
    prisma.invoice.findMany({
      where: { ...where, status: "due", dueDate: { gte: todayStart, lte: new Date(todayStart.getTime() + 14 * 86400000) } },
      include: { rider: { select: { firstName: true, lastName: true } } },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
  ]);

  // Bulk-pay panel input — every due invoice in scope, with cumulative
  // payments preloaded so the UI can show "outstanding" not "amount".
  const dueInvoicesForBulk = await prisma.invoice.findMany({
    where: { ...where, status: "due" },
    include: {
      rider: { select: { firstName: true, lastName: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 200,
  });
  const bulkRows = dueInvoicesForBulk.map((i) => {
    const paid = i.payments.reduce((s, p) => s + p.amount, 0);
    const outstanding = Math.max(0, i.amount + i.gstAmount - paid);
    return {
      id: i.id,
      label: `${i.rider.firstName} ${i.rider.lastName} · ${i.kind} · due ${i.dueDate.toISOString().slice(0, 10)}`,
      outstanding,
    };
  }).filter((r) => r.outstanding > 0.01);

  const incomeMTD = paidThisMonth._sum.amount ?? 0;
  const incomeYTD = paidYear._sum.amount ?? 0;
  const expenseMTD = expensesThisMonth._sum.amount ?? 0;
  const expenseYTD = expensesYear._sum.amount ?? 0;
  const netMTD = incomeMTD - expenseMTD;
  const netYTD = incomeYTD - expenseYTD;
  const outstandingAmt = outstanding._sum.amount ?? 0;

  const catIds = expenseByCategory.map((g) => g.categoryId);
  const cats = await prisma.expenseCategory.findMany({ where: { id: { in: catIds } } });
  const catName = new Map(cats.map((c) => [c.id, { name: c.name, group: c.group }]));
  const breakdown = expenseByCategory
    .map((g) => ({
      categoryId: g.categoryId,
      label: catName.get(g.categoryId)?.name ?? "Uncategorised",
      group: catName.get(g.categoryId)?.group ?? "other",
      amount: g._sum.amount ?? 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Finance</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportCsvButton entity="invoices" />
          <Button asChild variant="outline">
            <Link href="/finance/expenses/new">
              <Plus className="h-4 w-4" /> New expense
            </Link>
          </Button>
          <Button asChild>
            <Link href="/finance/expenses">Expenses</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Income (MTD)" value={inr(incomeMTD)} sub={`YTD ${inr(incomeYTD)}`} tone="green" icon={<TrendingUp className="h-5 w-5" />} />
        <StatTile label="Expenses (MTD)" value={inr(expenseMTD)} sub={`YTD ${inr(expenseYTD)}`} tone="rose" icon={<TrendingDown className="h-5 w-5" />} />
        <StatTile label="Net P&L (MTD)" value={inr(netMTD)} sub={`YTD ${inr(netYTD)}`} tone={netMTD >= 0 ? "green" : "rose"} icon={<IndianRupee className="h-5 w-5" />} />
        {/* Receivables only exist if this club bills riders. With fees off the
            figure is structurally zero, which reads as broken rather than as
            "not applicable". */}
        {feesOn && (
          <StatTile label="Outstanding" value={inr(outstandingAmt)} sub={`${outstanding._count} invoices · ${overdueCount} overdue`} tone="amber" icon={<Receipt className="h-5 w-5" />} />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Expenses by Category — YTD</CardTitle>
          </CardHeader>
          <CardContent>
            {breakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses booked this year yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {breakdown.slice(0, 8).map((b) => (
                  <li key={b.categoryId} className="flex items-center justify-between text-sm">
                    <span>
                      {b.label}
                      <span className="ml-2 text-[10px] uppercase text-muted-foreground">{b.group}</span>
                    </span>
                    <span className="font-mono">{inr(b.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Dues (14 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingDue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing due in the next two weeks.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {upcomingDue.map((i) => (
                  <li key={i.id} className="flex items-center justify-between border-b py-1 last:border-0">
                    <span>
                      {i.rider.firstName} {i.rider.lastName}{" "}
                      <span className="text-xs text-muted-foreground">· {formatEnum(i.kind)}</span>
                    </span>
                    <span>
                      <span className="mr-2 text-xs text-muted-foreground">{formatDate(i.dueDate)}</span>
                      <span className="font-mono">{inr(i.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {feesOn && can(session.role, "finance.write") && bulkRows.length > 0 && (
        <BulkMarkPaid dueInvoices={bulkRows} />
      )}

      {/* The rider-invoice ledger itself. A club with fees off has none, and
          an empty ledger invites staff to wonder what they've configured wrong. */}
      {feesOn && (
      <Card>
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2">Rider</th>
                  <th className="pb-2">Kind</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Due</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const outstandingForInv = bulkRows.find((r) => r.id === inv.id)?.outstanding ?? 0;
                  return (
                    <tr key={inv.id} className="border-t">
                      <td className="py-2">
                        <Link href={`/finance/rider/${inv.riderId}`} className="hover:underline">
                          {inv.rider.firstName} {inv.rider.lastName}
                        </Link>
                      </td>
                      <td className="py-2">{formatEnum(inv.kind)}</td>
                      <td className="py-2 font-mono">{inr(inv.amount)}</td>
                      <td className="py-2">{formatDate(inv.dueDate)}</td>
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
                        {can(session.role, "finance.write") && inv.status === "due" && outstandingForInv > 0 && (
                          <RecordPaymentButton invoiceId={inv.id} outstanding={outstandingForInv} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No invoices yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {recentExpenses.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              No expenses logged yet.{" "}
              <Link href="/finance/expenses/new" className="text-primary underline">
                Add one →
              </Link>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Description</th>
                    <th className="pb-2">Category</th>
                    <th className="pb-2">Vendor</th>
                    <th className="pb-2">Amount</th>
                    <th className="pb-2">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {recentExpenses.map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="py-2">{formatDate(e.spentAt)}</td>
                      <td className="py-2">{e.description}</td>
                      <td className="py-2 text-xs">{e.category.name}</td>
                      <td className="py-2 text-xs">{e.vendor?.name ?? "—"}</td>
                      <td className="py-2 font-mono">{inr(e.amount)}</td>
                      <td className="py-2">
                        <Badge variant={e.paid ? "success" : "warning"}>{e.paid ? "paid" : "due"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
