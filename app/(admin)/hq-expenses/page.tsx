import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HqExpenseForm } from "./form";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HqExpensesPage() {
  const session = (await getSession())!;
  // HQ-tier — ADMIN handles cross-club invoices alongside SUPER_ADMIN.
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");

  // Resolve orgId from the user row (not on the JWT).
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { orgId: true, centre: { select: { orgId: true } } },
  });
  const orgId = user?.orgId ?? user?.centre?.orgId ?? null;
  if (!orgId) redirect("/dashboard");

  const [categories, centres, expenses] = await Promise.all([
    prisma.expenseCategory.findMany({
      where: { active: true },
      select: { id: true, name: true, group: true },
      orderBy: [{ group: "asc" }, { name: "asc" }],
    }),
    prisma.centre.findMany({
      where: { orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.hqExpense.findMany({
      where: { orgId },
      include: { category: { select: { name: true } } },
      orderBy: { spentAt: "desc" },
      take: 100,
    }),
  ]);

  const centresById = Object.fromEntries(centres.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Record HQ invoice</CardTitle>
          <CardDescription>
            Payments made at the headquarters level — umbrella insurance, software, bulk orders, etc.
            Tag specific clubs if this expense should be allocated to them in rollup reports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HqExpenseForm categories={categories} centres={centres} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent HQ expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No HQ expenses recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Description</th>
                    <th className="pb-2">Vendor</th>
                    <th className="pb-2">Tagged clubs</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => {
                    const tagged = e.taggedCentreIdsCsv?.split(",").filter(Boolean) ?? [];
                    return (
                      <tr key={e.id} className="border-t align-top">
                        <td className="py-2 text-xs">{formatDate(e.spentAt)}</td>
                        <td className="py-2">
                          <div className="font-medium">{e.description}</div>
                          {e.category && (
                            <div className="text-xs text-muted-foreground">{e.category.name}</div>
                          )}
                        </td>
                        <td className="py-2 text-xs">{e.vendorName ?? "—"}</td>
                        <td className="py-2 text-xs">
                          {tagged.length === 0 ? (
                            <span className="text-muted-foreground">HQ overhead</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {tagged.map((cid) => (
                                <Badge key={cid} variant="outline">
                                  {centresById[cid] ?? cid}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-right font-mono">
                          ₹{e.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2">
                          <Badge variant={e.paid ? "success" : "warning"}>{e.paid ? "Paid" : "Unpaid"}</Badge>
                        </td>
                        <td className="py-2">
                          <a
                            href={e.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline"
                          >
                            View
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
