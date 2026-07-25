// Employee salary advance ledger. Admin/Accountant view: see all
// outstanding advances, issue new ones, record repayments deducted from
// payroll. Each row shows: amount, paid so far, remaining, status.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { AdvancesPanel } from "./panel";
import { formatEnum } from "@/lib/labels";
export const dynamic = "force-dynamic";

function canView(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

export default async function AdvancesPage() {
  const session = await requireSession();
  if (!canView(session.role)) redirect("/dashboard");

  const centreId = scopeCentre(session);
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const [advances, eligibleUsers] = await Promise.all([
    prisma.employeeAdvance.findMany({
      where: tenantWhere(centreId, orgId),
      include: {
        user: { select: { id: true, name: true, role: true } },
        repayments: { orderBy: { deductedAt: "desc" } },
      },
      orderBy: [{ status: "asc" }, { givenAt: "desc" }],
      take: 200,
    }),
    // Issue-to list — active staff at the caller's scope.
    prisma.user.findMany({
      where: {
        ...tenantWhere(centreId, orgId),
        status: "active",
        role: { notIn: ["SUPER_ADMIN", "ADMIN", "RIDER", "PARENT"] as any },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Pre-compute the outstanding balance for each row so the UI doesn't
  // have to re-sum on every render.
  const rows = advances.map((a) => {
    const paid = a.repayments.reduce((s, r) => s + r.amount, 0);
    return {
      id: a.id,
      amount: a.amount,
      paid,
      remaining: a.amount - paid,
      status: a.status,
      reason: a.reason,
      notes: a.notes,
      givenAt: a.givenAt.toISOString(),
      user: { id: a.user.id, name: a.user.name, role: a.user.role },
      repayments: a.repayments.map((r) => ({
        id: r.id,
        amount: r.amount,
        deductedAt: r.deductedAt.toISOString(),
        notes: r.notes,
      })),
    };
  });

  const outstanding = rows.filter((r) => r.status !== "repaid" && r.status !== "written_off");
  const closed = rows.filter((r) => r.status === "repaid" || r.status === "written_off");

  const totalOutstanding = outstanding.reduce((s, r) => s + r.remaining, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Salary Advances</h1>
        </div>
        <Badge variant={outstanding.length > 0 ? "warning" : "outline"} className="text-sm">
          ₹{Math.round(totalOutstanding).toLocaleString("en-IN")} outstanding across {outstanding.length}
        </Badge>
      </div>

      <AdvancesPanel rows={rows} eligibleUsers={eligibleUsers} />

      {closed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Closed ({closed.length})</CardTitle>
            <CardDescription>Repaid + written off — kept for the audit trail.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {closed.map((r) => (
                <li key={r.id} className="flex items-center justify-between border-b py-1.5 last:border-0">
                  <div>
                    <span className="font-medium">{r.user.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{r.reason}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono">₹{Math.round(r.amount).toLocaleString("en-IN")}</span>
                    <Badge variant="outline">{formatEnum(r.status)}</Badge>
                    <span className="text-muted-foreground">{formatDate(new Date(r.givenAt))}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
