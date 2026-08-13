import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatEnum } from "@/lib/labels";
import { PLATFORM_TZ } from "@/lib/tz";
export const dynamic = "force-dynamic";

type SP = { status?: string; org?: string };

const STATUS_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  paid: "default",
  due: "secondary",
  void: "outline",
};

export default async function SaasInvoicesPage({ searchParams }: { searchParams: SP }) {
  const statusFilter = searchParams.status;
  const orgFilter = searchParams.org;

  const where: any = {};
  if (statusFilter && ["due", "paid", "void"].includes(statusFilter)) where.status = statusFilter;
  if (orgFilter) where.orgId = orgFilter;

  const [invoices, summary] = await Promise.all([
    prisma.saasInvoice.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      take: 100,
      include: { org: { select: { id: true, name: true, slug: true } } },
    }),
    // Last-30-days totals — what the platform brought in vs what's still outstanding.
    prisma.saasInvoice.groupBy({
      by: ["status"],
      where: { issuedAt: { gte: new Date(Date.now() - 30 * 86400000) } },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const paid30d = summary.find((s) => s.status === "paid")?._sum.total ?? 0;
  const due30d = summary.find((s) => s.status === "due")?._sum.total ?? 0;

  return (
    <div className="space-y-6 text-foreground">
      <div>
        <h1 className="text-2xl font-bold">SaaS Invoices</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <KPI label="Paid · Last 30d" value={`₹${paid30d.toLocaleString("en-IN")}`} sub={`${summary.find((s) => s.status === "paid")?._count ?? 0} invoices`} />
        <KPI label="Outstanding · Last 30d" value={`₹${due30d.toLocaleString("en-IN")}`} sub={`${summary.find((s) => s.status === "due")?._count ?? 0} invoices`} warn={due30d > 0} />
        <KPI label="Total · Last 30d" value={`${summary.reduce((acc, s) => acc + s._count, 0)} invoices`} sub="across all tenants" />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">All Invoices</CardTitle>
            <CardDescription className="text-muted-foreground">Most recent first · cap 100. Filter via URL ?status=paid|due|void.</CardDescription>
          </div>
          <div className="flex gap-2 text-xs">
            <Link href="/owner/saas-invoices" className={!statusFilter ? "rounded bg-emerald-700 px-2 py-1" : "rounded border border-border px-2 py-1 hover:bg-muted"}>All</Link>
            <Link href="/owner/saas-invoices?status=due" className={statusFilter === "due" ? "rounded bg-emerald-700 px-2 py-1" : "rounded border border-border px-2 py-1 hover:bg-muted"}>Due</Link>
            <Link href="/owner/saas-invoices?status=paid" className={statusFilter === "paid" ? "rounded bg-emerald-700 px-2 py-1" : "rounded border border-border px-2 py-1 hover:bg-muted"}>Paid</Link>
            <Link href="/owner/saas-invoices?status=void" className={statusFilter === "void" ? "rounded bg-emerald-700 px-2 py-1" : "rounded border border-border px-2 py-1 hover:bg-muted"}>Void</Link>
          </div>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices match this filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs tracking-wider text-muted-foreground">
                  <tr>
                    <th className="pb-2">Number</th>
                    <th className="pb-2">Tenant</th>
                    <th className="pb-2">Plan</th>
                    <th className="pb-2">Period</th>
                    <th className="pb-2 text-right">Subtotal</th>
                    <th className="pb-2 text-right">GST</th>
                    <th className="pb-2 text-right">Total</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 font-mono text-xs">{i.number}</td>
                      <td className="py-2">
                        <Link href={`/owner/tenants/${i.orgId}`} className="hover:underline">{i.org.name}</Link>
                      </td>
                      <td className="py-2"><Badge variant="outline" className="text-[10px]">{i.plan}</Badge></td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {new Date(i.periodStart).toLocaleDateString("en-IN", { timeZone: PLATFORM_TZ, day: "2-digit", month: "short" })} → {new Date(i.periodEnd).toLocaleDateString("en-IN", { timeZone: PLATFORM_TZ, day: "2-digit", month: "short", year: "2-digit" })}
                      </td>
                      <td className="py-2 text-right">₹{i.subtotal.toLocaleString("en-IN")}</td>
                      <td className="py-2 text-right">₹{i.taxAmount.toLocaleString("en-IN")}</td>
                      <td className="py-2 text-right font-semibold">₹{i.total.toLocaleString("en-IN")}</td>
                      <td className="py-2">
                        <Badge variant={STATUS_VARIANT[i.status] ?? "outline"} className="text-xs">{formatEnum(i.status)}</Badge>
                      </td>
                      <td className="py-2 text-right">
                        <Link
                          href={`/owner/saas-invoices/${i.id}/print`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
                        >
                          Print/PDF
                        </Link>
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

function KPI({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="pt-6">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-bold ${warn ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
