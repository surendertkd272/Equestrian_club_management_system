import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BillingConfigForm } from "./form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PlatformBillingPage() {
  // Upsert on first visit so the form always has a row to bind to.
  const cfg = await prisma.platformBillingConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });

  return (
    <div className="space-y-6 text-slate-200">
      <div>
        <h1 className="text-2xl font-bold">Platform billing identity</h1>
        <p className="text-sm text-slate-400">
          Identifies <strong>your</strong> legal entity on every invoice we send to tenants. Tenants
          can't see this page — they see only the printed result on their SaaS invoice.
        </p>
      </div>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-base">Company details</CardTitle>
          <CardDescription className="text-slate-400">
            Update once. Lives on the singleton <code className="bg-slate-800 px-1">PlatformBillingConfig</code> row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BillingConfigForm initial={cfg} />
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-base">Invoice numbering</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-300">
          <div>
            Format: <code className="bg-slate-800 px-1">{cfg.invoicePrefix}-YYYY-NNNNNN</code>
          </div>
          <div>
            Current counter: <strong>{cfg.invoiceCounter}</strong> · next invoice will be{" "}
            <code className="bg-slate-800 px-1">
              {cfg.invoicePrefix}-{new Date().getFullYear()}-{String(cfg.invoiceCounter + 1).padStart(6, "0")}
            </code>
          </div>
          <div className="text-xs text-slate-500">
            The counter is bumped atomically when an invoice is issued — don't reset it mid-year
            or you'll create duplicates.
          </div>
        </CardContent>
      </Card>

      <div className="text-sm">
        <Link href="/owner/saas-invoices" className="text-emerald-400 hover:underline">
          View issued SaaS invoices →
        </Link>
      </div>
    </div>
  );
}
