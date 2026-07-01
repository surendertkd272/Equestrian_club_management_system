import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitExpenseForm } from "./form";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function SubmitExpensePage() {
  const session = (await getSession())!;
  if (!can(session.role, "expense.submit")) redirect("/dashboard");

  // Category list for the dropdown — optional pick. Anyone in the same
  // org sees the same chart of accounts (curated by HQ).
  const [categories, myRecent] = await Promise.all([
    prisma.expenseCategory.findMany({
      where: { active: true },
      select: { id: true, name: true, group: true },
      orderBy: [{ group: "asc" }, { name: "asc" }],
    }),
    prisma.expense.findMany({
      where: { createdBy: session.userId },
      include: { category: { select: { name: true } } },
      orderBy: { spentAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Submit Invoice</CardTitle>
          <CardDescription>
            Bought feed, medicine, or equipment for the club? Upload the bill here. The accountant
            sees every submission and marks it paid once reimbursed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubmitExpenseForm categories={categories} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Recent Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          {myRecent.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nothing submitted yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Description</th>
                  <th className="pb-2 text-right">Amount</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {myRecent.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="py-2 text-xs">{formatDate(e.spentAt)}</td>
                    <td className="py-2">
                      <div className="font-medium">{e.description}</div>
                      <div className="text-xs text-muted-foreground">{e.category.name}</div>
                    </td>
                    <td className="py-2 text-right font-mono">
                      ₹{e.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2">
                      <Badge variant={e.paid ? "success" : "warning"}>{e.paid ? "Reimbursed" : "Pending"}</Badge>
                    </td>
                    <td className="py-2">
                      {e.attachmentUrl ? (
                        <a
                          href={e.attachmentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
