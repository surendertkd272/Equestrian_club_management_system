import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { PrintButton } from "../[riderId]/print-button";

export const dynamic = "force-dynamic";

const CAN_VIEW = ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "ACCOUNTANT"];

// The four procurement categories, in the order the report should read.
// Maps each to its seeded ExpenseCategory `code` (prisma/seed.ts).
const CATEGORY_VIEW = [
  { code: "vet_farrier", label: "Farrier" },
  { code: "feed_grain", label: "Fodder" },
  { code: "feed_hay", label: "Hay" },
  { code: "vet_medicine", label: "Vet medicines" },
] as const;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Club-wise procurement snapshot: for each club, the MOST RECENT purchase in
// each category — last date, rate, qty, amount, payment, vendor.
export default async function ProcurementReportPage() {
  const session = (await getSession())!;
  if (!CAN_VIEW.includes(session.role)) redirect("/dashboard");

  // Scope: centre-bound users see their own club; HQ admins see every club
  // in their org.
  const ownCentre = scopeCentre(session);
  const orgId = ownCentre ? null : await getOrgIdForSession(session);
  const centres = ownCentre
    ? await prisma.centre.findMany({ where: { id: ownCentre }, select: { id: true, name: true } })
    : await prisma.centre.findMany({
        where: orgId ? { orgId } : {},
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });

  const cats = await prisma.expenseCategory.findMany({
    where: { code: { in: CATEGORY_VIEW.map((c) => c.code) } },
    select: { id: true, code: true },
  });
  const catIdByCode = new Map(cats.map((c) => [c.code, c.id]));

  // All expenses in those categories for the in-scope clubs, newest first.
  const expenses = await prisma.expense.findMany({
    where: { centreId: { in: centres.map((c) => c.id) }, categoryId: { in: cats.map((c) => c.id) } },
    include: { vendor: { select: { name: true } } },
    orderBy: { spentAt: "desc" },
  });

  // Latest expense per (centre, category) — first hit wins since list is desc.
  const latest = new Map<string, (typeof expenses)[number]>();
  for (const e of expenses) {
    const key = `${e.centreId}:${e.categoryId}`;
    if (!latest.has(key)) latest.set(key, e);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Procurement report</h1>
          <p className="text-sm text-muted-foreground">
            Club-wise — the latest farrier, fodder, hay and vet-medicine purchase per club.
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Procurement report — latest per category</h1>
        <p className="text-xs text-muted-foreground">Generated {formatDate(new Date())}</p>
      </div>

      {centres.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No clubs in scope.</CardContent>
        </Card>
      ) : (
        centres.map((centre) => (
          <Card key={centre.id}>
            <CardHeader>
              <CardTitle className="text-base">{centre.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2">Category</th>
                    <th className="pb-2">Last date</th>
                    <th className="pb-2 text-right">Rate</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2">Payment</th>
                    <th className="pb-2">Vendor</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORY_VIEW.map(({ code, label }) => {
                    const catId = catIdByCode.get(code);
                    const e = catId ? latest.get(`${centre.id}:${catId}`) : undefined;
                    return (
                      <tr key={code} className="border-t">
                        <td className="py-2 font-medium">{label}</td>
                        {e ? (
                          <>
                            <td className="py-2">{formatDate(e.spentAt)}</td>
                            <td className="py-2 text-right font-mono">
                              {inr(e.unitRate ?? e.amount)}
                              {e.unitRate != null && <span className="text-[10px] text-muted-foreground"> /unit</span>}
                            </td>
                            <td className="py-2 text-right font-mono">{e.qty != null ? e.qty : "—"}</td>
                            <td className="py-2 text-right font-mono">{inr(e.amount)}</td>
                            <td className="py-2">
                              {e.paid ? (
                                <Badge variant="success">
                                  Paid{e.method ? ` · ${e.method}` : ""}
                                </Badge>
                              ) : (
                                <Badge variant="outline">Unpaid</Badge>
                              )}
                            </td>
                            <td className="py-2">{e.vendor?.name ?? "—"}</td>
                          </>
                        ) : (
                          <td className="py-2 text-muted-foreground" colSpan={6}>
                            No record
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
