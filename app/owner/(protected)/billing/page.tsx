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
    <div className="space-y-6 text-foreground">
      <div>
        <h1 className="text-2xl font-bold">Platform Billing Identity</h1>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Company Details</CardTitle>
          <CardDescription className="text-muted-foreground">
            Update once. Lives on the singleton <code className="bg-muted px-1">PlatformBillingConfig</code> row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BillingConfigForm initial={cfg} />
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Invoice Numbering</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-foreground">
          <div>
            Format: <code className="bg-muted px-1">{cfg.invoicePrefix}-YYYY-NNNNNN</code>
          </div>
          <div>
            Current counter: <strong>{cfg.invoiceCounter}</strong> · next invoice will be{" "}
            <code className="bg-muted px-1">
              {cfg.invoicePrefix}-{new Date().getFullYear()}-{String(cfg.invoiceCounter + 1).padStart(6, "0")}
            </code>
          </div>
          <div className="text-xs text-muted-foreground">
            The counter is bumped atomically when an invoice is issued — don't reset it mid-year
            or you'll create duplicates.
          </div>
        </CardContent>
      </Card>

      <div className="text-sm">
        <Link href="/owner/saas-invoices" className="text-emerald-700 dark:text-emerald-400 hover:underline">
          View issued SaaS invoices →
        </Link>
      </div>
    </div>
  );
}
