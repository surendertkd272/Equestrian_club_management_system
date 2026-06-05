import { ensurePricingRows } from "@/lib/pricing";
import { PricingForm } from "./form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OwnerPricingPage() {
  const rows = await ensurePricingRows();

  return (
    <div className="space-y-6 text-foreground">
      <div>
        <h1 className="text-2xl font-bold">Pricing</h1>
        <p className="text-sm text-muted-foreground">
          The public <Link href="/pricing" target="_blank" className="text-emerald-700 dark:text-emerald-400 hover:underline">/pricing</Link>{" "}
          page renders directly from these rows. Edit, save, and the next visitor sees the new numbers — no deploy required.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          <strong>Important:</strong> these display prices and the actual billed amount are decoupled. Razorpay charges
          whatever the plan in their dashboard says — paste the plan id into the field below so we know which one to mint
          subscriptions against. Mismatch = customers see one price and pay another.
        </p>
      </div>

      <div className="grid gap-4">
        {rows.map((row) => (
          <Card key={row.key} className="border-border bg-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {row.label || row.key}
                  {row.highlight && (
                    <span className="ml-2 rounded-full bg-amber-100 dark:bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                      MOST POPULAR
                    </span>
                  )}
                  {!row.isVisible && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground">
                      HIDDEN
                    </span>
                  )}
                </CardTitle>
                <code className="text-[10px] text-muted-foreground">key: {row.key}</code>
              </div>
              <CardDescription className="text-muted-foreground">
                Sort order {row.sortOrder} · last updated{" "}
                {new Date(row.updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PricingForm initial={row} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
