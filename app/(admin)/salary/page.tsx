// Salary & Payroll. Two parts:
//   1. Salary structure master — every staff member's salary + raise history.
//      Only Super Admin defines salaries.
//   2. Salary recorder — auto-computes net = base − (base/30 × absent days) −
//      advance recovery − other deductions.
// Companion to /advances (the advance ledger).

import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { SalaryStructureTable } from "./structure-table";
import { SalaryPanel } from "./panel";
import { MarkPaidButton } from "./mark-paid-button";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { roleLabel } from "@/lib/labels";
export const dynamic = "force-dynamic";

function canView(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

export default async function SalaryPage() {
  const session = (await getSession())!;
  if (!canView(session.role)) redirect("/dashboard");

  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/dashboard");
  const centreId = scopeCentre(session);

  const [staff, structures, recent] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...tenantWhere(centreId, orgId),
        status: "active",
        role: { notIn: ["SUPER_ADMIN", "ADMIN", "RIDER", "PARENT"] as any },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.salaryStructure.findMany({
      where: tenantWhere(centreId, orgId),
      orderBy: { effectiveFrom: "desc" },
    }),
    prisma.salaryPayment.findMany({
      where: tenantWhere(centreId, orgId),
      include: { user: { select: { name: true, role: true } } },
      orderBy: [{ periodMonth: "desc" }, { createdAt: "desc" }],
      take: 40,
    }),
  ]);

  // Latest (current) salary per staff + count of historical revisions.
  const currentByUser = new Map<string, { monthlySalary: number; effectiveFrom: Date; count: number }>();
  for (const s of structures) {
    const ex = currentByUser.get(s.userId);
    if (!ex) {
      currentByUser.set(s.userId, { monthlySalary: s.monthlySalary, effectiveFrom: s.effectiveFrom, count: 1 });
    } else {
      ex.count += 1; // structures are desc, so the first seen is the latest
    }
  }

  const staffRows = staff.map((s) => {
    const cur = currentByUser.get(s.id);
    return {
      id: s.id,
      name: s.name,
      role: s.role,
      monthlySalary: cur?.monthlySalary ?? null,
      effectiveFrom: cur?.effectiveFrom?.toISOString() ?? null,
      revisions: cur?.count ?? 0,
    };
  });

  const nowMonth = (() => {
    const ist = new Date(Date.now() + 330 * 60_000);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Salary &amp; Payroll</h1>
        <p className="text-sm text-muted-foreground">
          Define each staff member's salary (Super Admin only), then record monthly pay — one
          absent day deducts base ÷ 30, and outstanding advances are recovered automatically.
          See the advance ledger at <Link href="/advances" className="underline">Salary advances</Link>.
        </p>
      </div>

      {/* Salary master — Super Admin sets / raises each staff member's pay. */}
      <SalaryStructureTable staff={staffRows} canEdit={session.role === "SUPER_ADMIN"} />

      {/* Recorder — auto-computes from structure + config + attendance. */}
      <SalaryPanel staff={staffRows.map((s) => ({ id: s.id, name: s.name, role: s.role }))} defaultMonth={nowMonth} />

      <Card>
        <CardHeader>
          <CardTitle>Recent Salary Payments</CardTitle>
          <CardDescription>Last 40 — gross, deductions, and net.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            rows={recent}
            getRowKey={(p) => p.id}
            emptyMessage="No salary recorded yet."
            columns={[
              {
                key: "staff",
                header: "Staff",
                primary: true,
                cell: (p) => (
                  <>
                    <div className="font-medium">{p.user.name}</div>
                    <div className="text-[11px] text-muted-foreground">{roleLabel(p.user.role)}</div>
                  </>
                ),
              },
              { key: "month", header: "Month", cell: (p) => p.periodMonth },
              {
                key: "gross",
                header: "Gross",
                headerClassName: "text-right",
                className: "text-right font-mono",
                cell: (p) => `₹${Math.round(p.grossAmount).toLocaleString("en-IN")}`,
              },
              {
                key: "attendance",
                header: "Attendance",
                headerClassName: "text-right",
                className: "text-right font-mono text-amber-700",
                cell: (p) => (
                  <>
                    {p.attendanceDeducted > 0 ? `−₹${Math.round(p.attendanceDeducted).toLocaleString("en-IN")}` : "—"}
                    {p.absentDays > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({p.absentDays}a)</span>}
                  </>
                ),
              },
              {
                key: "advance",
                header: "Advance",
                headerClassName: "text-right",
                className: "text-right font-mono text-amber-700",
                cell: (p) =>
                  p.advanceDeducted > 0 ? `−₹${Math.round(p.advanceDeducted).toLocaleString("en-IN")}` : "—",
              },
              {
                key: "other",
                header: "Other",
                headerClassName: "text-right",
                className: "text-right font-mono",
                cell: (p) =>
                  p.otherDeductions > 0 ? `−₹${Math.round(p.otherDeductions).toLocaleString("en-IN")}` : "—",
              },
              {
                key: "net",
                header: "Net",
                headerClassName: "text-right",
                className: "text-right font-mono font-semibold",
                cell: (p) => `₹${Math.round(p.netAmount).toLocaleString("en-IN")}`,
              },
              {
                key: "status",
                header: "Status",
                cell: (p) => (
                  <div className="flex items-center gap-2">
                    <Badge variant={p.paidAt ? "success" : "outline"}>
                      {p.paidAt ? `paid ${formatDate(p.paidAt)}` : "recorded"}
                    </Badge>
                    {!p.paidAt && <MarkPaidButton id={p.id} />}
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
