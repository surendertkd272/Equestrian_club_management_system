// Salary & Payroll. Three parts:
//   1. Payroll settings — global per-status deduction rates (Super Admin/Admin)
//   2. Salary structure master — every staff member's salary + raise history
//   3. Salary recorder — auto-computes gross + attendance + advance deductions
// Companion to /advances (the advance ledger).

import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { parseDeductionRules } from "@/lib/schemas/payroll";
import { PayrollSettings } from "./payroll-settings";
import { SalaryStructureTable } from "./structure-table";
import { SalaryPanel } from "./panel";
import { MarkPaidButton } from "./mark-paid-button";

export const dynamic = "force-dynamic";

function canView(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "ACCOUNTANT";
}

export default async function SalaryPage() {
  const session = (await getSession())!;
  if (!canView(session.role)) redirect("/dashboard");

  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const centreId = scopeCentre(session);

  // Resolve the org for the global payroll config.
  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { orgId: true, centre: { select: { orgId: true } } },
  });
  const orgId = me?.orgId ?? me?.centre?.orgId ?? null;
  const config = orgId ? await prisma.payrollConfig.findUnique({ where: { orgId } }) : null;
  const rules = parseDeductionRules(config?.deductionRulesJson);

  const [staff, structures, recent] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...centreWhere(centreId),
        status: "active",
        role: { notIn: ["SUPER_ADMIN", "ADMIN", "RIDER", "PARENT"] as any },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.salaryStructure.findMany({
      where: centreWhere(centreId),
      orderBy: { effectiveFrom: "desc" },
    }),
    prisma.salaryPayment.findMany({
      where: centreWhere(centreId),
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
          Define each staff member's salary, set the global per-absent deduction, then record
          monthly pay — attendance deductions and outstanding advances are applied automatically.
          See the advance ledger at <Link href="/advances" className="underline">Salary Advances</Link>.
        </p>
      </div>

      {/* Global deduction config — HQ tier only. Accountant sees it read-only. */}
      <PayrollSettings initialRules={rules} canEdit={isHQ} />

      {/* Salary master — set / raise each staff member's pay. */}
      <SalaryStructureTable staff={staffRows} />

      {/* Recorder — auto-computes from structure + config + attendance. */}
      <SalaryPanel staff={staffRows.map((s) => ({ id: s.id, name: s.name, role: s.role }))} defaultMonth={nowMonth} />

      <Card>
        <CardHeader>
          <CardTitle>Recent salary payments</CardTitle>
          <CardDescription>Last 40 — gross, deductions, and net.</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No salary recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2">Staff</th>
                    <th className="pb-2">Month</th>
                    <th className="pb-2 text-right">Gross</th>
                    <th className="pb-2 text-right">Attendance</th>
                    <th className="pb-2 text-right">Advance</th>
                    <th className="pb-2 text-right">Other</th>
                    <th className="pb-2 text-right">Net</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-2">
                        <div className="font-medium">{p.user.name}</div>
                        <div className="text-[11px] text-muted-foreground">{p.user.role.replace(/_/g, " ").toLowerCase()}</div>
                      </td>
                      <td className="py-2">{p.periodMonth}</td>
                      <td className="py-2 text-right font-mono">₹{Math.round(p.grossAmount).toLocaleString("en-IN")}</td>
                      <td className="py-2 text-right font-mono text-amber-700">
                        {p.attendanceDeducted > 0 ? `−₹${Math.round(p.attendanceDeducted).toLocaleString("en-IN")}` : "—"}
                        {p.absentDays > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({p.absentDays}a)</span>}
                      </td>
                      <td className="py-2 text-right font-mono text-amber-700">
                        {p.advanceDeducted > 0 ? `−₹${Math.round(p.advanceDeducted).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {p.otherDeductions > 0 ? `−₹${Math.round(p.otherDeductions).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="py-2 text-right font-mono font-semibold">₹{Math.round(p.netAmount).toLocaleString("en-IN")}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={p.paidAt ? "success" : "outline"}>
                            {p.paidAt ? `paid ${formatDate(p.paidAt)}` : "recorded"}
                          </Badge>
                          {!p.paidAt && <MarkPaidButton id={p.id} />}
                        </div>
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
