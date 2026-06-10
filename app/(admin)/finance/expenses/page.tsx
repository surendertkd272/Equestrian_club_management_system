import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { BulkReimburse } from "./bulk-reimburse";
import { DeleteEntityButton } from "@/components/ui/delete-entity-button";

export const dynamic = "force-dynamic";

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: { group?: string; paid?: string };
}) {
  const session = (await getSession())!;
  if (!can(session.role, "finance.read")) {
    return <div className="p-4 text-sm text-muted-foreground">No access.</div>;
  }
  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const where: any = { ...tenantWhere(centreId, orgId) };
  if (searchParams.paid === "paid") where.paid = true;
  if (searchParams.paid === "due") where.paid = false;

  let categoryFilter: { id: string }[] | null = null;
  if (searchParams.group) {
    const cats = await prisma.expenseCategory.findMany({
      where: { group: searchParams.group },
      select: { id: true },
    });
    categoryFilter = cats;
    where.categoryId = { in: cats.map((c) => c.id) };
  }

  const [expenses, totals, dueExpenses] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: { category: { select: { name: true, group: true } }, vendor: { select: { name: true } } },
      orderBy: { spentAt: "desc" },
      take: 200,
    }),
    prisma.expense.aggregate({ where, _sum: { amount: true }, _count: true }),
    // Bulk-reimburse always pulls the FULL due set (ignores the page's
    // group/paid filters) so the accountant can clear the backlog in one
    // pass without having to re-filter the page.
    prisma.expense.findMany({
      where: { ...tenantWhere(centreId, orgId), paid: false },
      select: {
        id: true,
        amount: true,
        description: true,
        createdBy: true,
      },
      orderBy: { spentAt: "desc" },
      take: 200,
    }),
  ]);

  const canManage = can(session.role, "expense.manage");

  // Build a name index for the submitter labels in the bulk panel. Saves
  // an N+1 lookup vs including User on every Expense row above.
  const submitterIds = Array.from(new Set(dueExpenses.map((e) => e.createdBy).filter((x): x is string => !!x)));
  const submitters = submitterIds.length
    ? await prisma.user.findMany({
        where: { id: { in: submitterIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(submitters.map((u) => [u.id, u.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/finance">
              <ChevronLeft className="h-4 w-4" /> Finance
            </Link>
          </Button>
          <h1 className="mt-1 text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            {totals._count} entries · Total {inr(totals._sum.amount ?? 0)}
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/finance/expenses/new">
              <Plus className="h-4 w-4" /> New expense
            </Link>
          </Button>
        )}
      </div>

      {canManage && (
        <BulkReimburse
          due={dueExpenses.map((e) => ({
            id: e.id,
            amount: e.amount,
            label: e.description,
            submitter: e.createdBy ? (nameById.get(e.createdBy) ?? "—") : "—",
          }))}
        />
      )}

      <Card>
        <CardHeader>
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Group</label>
              <select aria-label="Filter by group"
                name="group"
                defaultValue={searchParams.group ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="operating">Operating</option>
                <option value="salaries">Salaries</option>
                <option value="vet">Vet</option>
                <option value="feed">Feed</option>
                <option value="maintenance">Maintenance</option>
                <option value="utilities">Utilities</option>
                <option value="tax">Tax</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Paid</label>
              <select aria-label="Filter by paid"
                name="paid"
                defaultValue={searchParams.paid ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All</option>
                <option value="paid">Paid only</option>
                <option value="due">Due only</option>
              </select>
            </div>
            <Button type="submit" size="sm" variant="outline">Filter</Button>
          </form>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Description</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Vendor</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Status</th>
                  {canManage && <th className="pb-2"></th>}
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="py-2">{formatDate(e.spentAt)}</td>
                    <td className="py-2">{e.description}</td>
                    <td className="py-2 text-xs">
                      {e.category.name}
                      <Badge variant="outline" className="ml-1 text-[10px] uppercase">{e.category.group}</Badge>
                    </td>
                    <td className="py-2 text-xs">{e.vendor?.name ?? "—"}</td>
                    <td className="py-2 font-mono">{inr(e.amount)}</td>
                    <td className="py-2">
                      <Badge variant={e.paid ? "success" : "warning"}>{e.paid ? "paid" : "due"}</Badge>
                    </td>
                    {canManage && (
                      <td className="py-2 text-right">
                        <DeleteEntityButton
                          endpoint={`/api/expenses/${e.id}`}
                          entityLabel="expense"
                          redirectTo="/finance/expenses"
                          confirmBody={`Delete "${e.description}" (${inr(e.amount)})? This cannot be undone.`}
                        />
                      </td>
                    )}
                  </tr>
                ))}
                {expenses.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 7 : 6} className="py-12 text-center text-muted-foreground">
                      No expenses match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
