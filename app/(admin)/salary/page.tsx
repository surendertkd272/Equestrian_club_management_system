// Monthly salary settlement. Records gross pay and auto-deducts any
// outstanding employee advances (oldest-first), so "advance debited from
// salary" is one action. Companion to /advances (the advance ledger).

import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { SalaryPanel } from "./panel";

export const dynamic = "force-dynamic";

function canView(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

export default async function SalaryPage() {
  const session = (await getSession())!;
  if (!canView(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);

  const [staff, advances, recent] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...centreWhere(centreId),
        status: "active",
        role: { notIn: ["SUPER_ADMIN", "ADMIN", "RIDER", "PARENT"] as any },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.employeeAdvance.findMany({
      where: { ...centreWhere(centreId), status: { in: ["outstanding", "partially_repaid"] } },
      include: { repayments: { select: { amount: true } } },
    }),
    prisma.salaryPayment.findMany({
      where: centreWhere(centreId),
      include: { user: { select: { name: true, role: true } } },
      orderBy: [{ periodMonth: "desc" }, { createdAt: "desc" }],
      take: 40,
    }),
  ]);

  // Outstanding advance balance per user, for the deduction hint in the form.
  const outstandingByUser = new Map<string, number>();
  for (const a of advances) {
    const repaid = a.repayments.reduce((s, r) => s + r.amount, 0);
    const rem = Math.max(0, a.amount - repaid);
    outstandingByUser.set(a.userId, (outstandingByUser.get(a.userId) ?? 0) + rem);
  }

  const staffWithBalance = staff.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    outstandingAdvance: Math.round(outstandingByUser.get(s.id) ?? 0),
  }));

  const nowMonth = (() => {
    const ist = new Date(Date.now() + 330 * 60_000);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Salary &amp; Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Record monthly salary. Outstanding advances are deducted automatically and posted
            against the staff member's advance balance. See the full ledger at{" "}
            <Link href="/advances" className="underline">Salary Advances</Link>.
          </p>
        </div>
      </div>

      <SalaryPanel staff={staffWithBalance} defaultMonth={nowMonth} />

      <Card>
        <CardHeader>
          <CardTitle>Recent salary payments</CardTitle>
          <CardDescription>Last 40 across staff.</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No salary recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2">Staff</th>
                    <th className="pb-2">Month</th>
                    <th className="pb-2 text-right">Gross</th>
                    <th className="pb-2 text-right">Advance ded.</th>
                    <th className="pb-2 text-right">Other ded.</th>
                    <th className="pb-2 text-right">Net</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-2">
                        <div className="font-medium">{p.user.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.user.role.replace(/_/g, " ").toLowerCase()}
                        </div>
                      </td>
                      <td className="py-2">{p.periodMonth}</td>
                      <td className="py-2 text-right font-mono">₹{Math.round(p.grossAmount).toLocaleString("en-IN")}</td>
                      <td className="py-2 text-right font-mono text-amber-700">
                        {p.advanceDeducted > 0 ? `−₹${Math.round(p.advanceDeducted).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {p.otherDeductions > 0 ? `−₹${Math.round(p.otherDeductions).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="py-2 text-right font-mono font-semibold">₹{Math.round(p.netAmount).toLocaleString("en-IN")}</td>
                      <td className="py-2">
                        <Badge variant={p.paidAt ? "success" : "outline"}>
                          {p.paidAt ? `paid ${formatDate(p.paidAt)}` : "recorded"}
                        </Badge>
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
