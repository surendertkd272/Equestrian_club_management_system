import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { scopeCentre, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/permissions";
import { tracksDues, canContactAboutMoney } from "@/lib/money-contact";
import { creditPosition } from "@/lib/credit-note";
import { formatDate } from "@/lib/utils";
import { RaiseDue } from "./raise-due";

export const dynamic = "force-dynamic";

// Who owes what, and for how long.
//
// A club tracking dues internally has no other way to see this: the family is
// never shown a bill and never chased, so the ledger IS the record. Aged into
// buckets because "₹2,91,000 outstanding" and "₹2,91,000 outstanding, most of
// it over 90 days" call for very different conversations.

const BUCKETS = [
  { key: "current", label: "Not yet due", min: -Infinity, max: 0 },
  { key: "d30", label: "1–30 days", min: 1, max: 30 },
  { key: "d60", label: "31–60 days", min: 31, max: 60 },
  { key: "d90", label: "61–90 days", min: 61, max: 90 },
  { key: "old", label: "Over 90 days", min: 91, max: Infinity },
] as const;

export default async function DuesPage() {
  const session = await requireSession();
  if (!can(session.role, "finance.read") && !can(session.role, "finance.write")) {
    redirect("/dashboard");
  }
  const orgId = await getOrgIdForSession(session);
  if (!orgId) redirect("/no-organisation");
  if (!(await tracksDues(orgId))) redirect("/finance");

  const centreId = scopeCentre(session);
  const where = tenantWhere(centreId, orgId);
  const mayContact = await canContactAboutMoney(orgId);

  const invoices = await prisma.invoice.findMany({
    where: {
      ...where,
      status: { in: ["due", "overdue"] },
      voidedAt: null,
      // A credit note is a negative invoice, not something anybody owes.
      creditNoteForId: null,
      rider: { status: { not: "withdrawn" } },
    },
    include: {
      rider: { select: { id: true, firstName: true, lastName: true } },
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true, gstAmount: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 2000,
  });

  const now = Date.now();
  const rows = invoices
    .map((inv) => {
      const pos = creditPosition(inv);
      const daysOverdue = Math.floor((now - inv.dueDate.getTime()) / 86400_000);
      return { inv, outstanding: pos.outstanding, daysOverdue };
    })
    // Partly-paid and fully-credited invoices net to zero; they are settled in
    // substance and listing them as debt would overstate what is owed.
    .filter((r) => r.outstanding > 0.001);

  const total = rows.reduce((t, r) => t + r.outstanding, 0);
  const buckets = BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => r.daysOverdue >= b.min && r.daysOverdue <= b.max);
    return { ...b, count: inBucket.length, sum: inBucket.reduce((t, r) => t + r.outstanding, 0) };
  });

  const riders = can(session.role, "finance.write") && centreId
    ? await prisma.rider.findMany({
        where: { centreId, status: { notIn: ["withdrawn", "rejected", "cancelled"] } },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }],
        take: 1000,
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Outstanding dues</h1>
        <p className="text-sm text-muted-foreground">
          What riders owe, aged by how overdue it is.{" "}
          {mayContact
            ? "Families can see and are reminded about these."
            : "Kept for your records only — families are never shown or told about these."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            ₹{total.toLocaleString("en-IN", { maximumFractionDigits: 0 })} outstanding
          </CardTitle>
          <CardDescription>
            {rows.length} unpaid invoice{rows.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-5">
            {buckets.map((b) => (
              <div key={b.key} className="rounded-md border p-3">
                <div className="text-[11px] uppercase text-muted-foreground">{b.label}</div>
                <div className="text-lg font-semibold">
                  ₹{b.sum.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {b.count} invoice{b.count === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {riders.length > 0 && (
        <RaiseDue riders={riders.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` }))} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Every unpaid invoice</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Rider</th>
                    <th className="py-2 pr-3">For</th>
                    <th className="py-2 pr-3">Due</th>
                    <th className="py-2 pr-3">Age</th>
                    <th className="py-2 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map(({ inv, outstanding, daysOverdue }) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <Link href={`/riders/${inv.rider.id}`} className="hover:underline">
                          {inv.rider.firstName} {inv.rider.lastName}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{inv.kind}</td>
                      <td className="py-2 pr-3 text-xs">{formatDate(inv.dueDate)}</td>
                      <td className="py-2 pr-3">
                        {daysOverdue <= 0 ? (
                          <span className="text-xs text-muted-foreground">Not yet due</span>
                        ) : (
                          <Badge variant={daysOverdue > 90 ? "destructive" : daysOverdue > 30 ? "warning" : "outline"}>
                            {daysOverdue}d
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 text-right font-medium">
                        ₹{outstanding.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 500 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the 500 oldest of {rows.length}.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
