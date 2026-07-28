import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { HqExpenseForm } from "./form";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HqExpensesPage() {
  const session = await requireSession();
  // HQ-tier — ADMIN handles cross-club invoices alongside SUPER_ADMIN.
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");

  // Resolve orgId from the user row (not on the JWT).
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { orgId: true, centre: { select: { orgId: true } } },
  });
  const orgId = user?.orgId ?? user?.centre?.orgId ?? null;
  if (!orgId) redirect("/no-organisation");

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
          <CardTitle>Record HQ Invoice</CardTitle>
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
          <CardTitle>Recent HQ Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={expenses}
            getRowKey={(e) => e.id}
            emptyMessage="No HQ expenses recorded yet."
            columns={[
              { key: "date", header: "Date", cell: (e) => <span className="text-xs">{formatDate(e.spentAt)}</span> },
              {
                key: "description",
                header: "Description",
                primary: true,
                cell: (e) => (
                  <>
                    <div className="font-medium">{e.description}</div>
                    {e.category && (
                      <div className="text-xs text-muted-foreground">{e.category.name}</div>
                    )}
                  </>
                ),
              },
              { key: "vendor", header: "Vendor", cell: (e) => <span className="text-xs">{e.vendorName ?? "—"}</span> },
              {
                key: "tagged",
                header: "Tagged Clubs",
                cell: (e) => {
                  const tagged = e.taggedCentreIdsCsv?.split(",").filter(Boolean) ?? [];
                  return tagged.length === 0 ? (
                    <span className="text-xs text-muted-foreground">HQ overhead</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {tagged.map((cid) => (
                        <Badge key={cid} variant="outline">
                          {centresById[cid] ?? cid}
                        </Badge>
                      ))}
                    </div>
                  );
                },
              },
              {
                key: "amount",
                header: "Amount",
                headerClassName: "text-right",
                className: "text-right font-mono",
                cell: (e) => <>₹{e.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</>,
              },
              {
                key: "status",
                header: "Status",
                cell: (e) => <Badge variant={e.paid ? "success" : "warning"}>{e.paid ? "Paid" : "Unpaid"}</Badge>,
              },
              {
                key: "invoice",
                header: "Invoice",
                cell: (e) => (
                  <a
                    href={e.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    View
                  </a>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
