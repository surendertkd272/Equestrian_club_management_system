"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Write off invoices that should never have been raised.
//
// The case this exists for: a club had rider billing switched on when it
// should not have been, so every approved rider was issued a registration
// invoice — dozens of them, none paid, all counted as outstanding money nobody
// intends to collect. Voiding one at a time is a click per rider, and doing it
// in the database directly leaves no audit trail, which for a write-off of a
// couple of lakh is the wrong trade.
//
// Counts first, always. The confirmation names the number AND the rupee total,
// because "void 97 invoices" and "write off ₹2,91,000" prompt different levels
// of care from the person clicking.
export function BulkVoidInvoices({ centreId }: { centreId: string | null }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (reason.trim().length < 3) {
      toast.error("Give a reason — it is stored on every invoice you void.");
      return;
    }
    setBusy(true);
    try {
      const pre = await fetch("/api/invoices/bulk-void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ centreId, reason, dryRun: true }),
      });
      if (!pre.ok) {
        const e = await pre.json().catch(() => ({}));
        toast.error(e.message ?? e.error ?? "Couldn't check what would be voided");
        return;
      }
      const { count, total } = await pre.json();
      if (count === 0) {
        toast.info("Nothing to void — no unpaid invoices here.");
        return;
      }
      if (
        !confirm(
          `Void ${count} unpaid invoice${count === 1 ? "" : "s"}, writing off ₹${total.toLocaleString("en-IN")}?\n\n` +
            `They stay on the ledger marked void, with your name and reason against each one — nothing is deleted.\n\n` +
            `Invoices with a payment against them are never touched.`,
        )
      ) {
        return;
      }
      const res = await fetch("/api/invoices/bulk-void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ centreId, reason }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e.message ?? e.error ?? "Couldn't void");
        return;
      }
      const data = await res.json();
      toast.success(
        `Voided ${data.count} invoice${data.count === 1 ? "" : "s"} · ₹${data.total.toLocaleString("en-IN")} written off`,
      );
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Void unpaid invoices in bulk</CardTitle>
        <CardDescription>
          For charges that should never have been raised — billing switched on by mistake, a
          duplicate run. Invoices someone has actually paid are never included; those need a
          credit note instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1 space-y-1">
          <label htmlFor="void-reason" className="text-xs text-muted-foreground">
            Reason — stored on every invoice you void
          </label>
          <Input
            id="void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Raised while rider billing was enabled in error"
            maxLength={300}
          />
        </div>
        <Button variant="outline" onClick={run} disabled={busy}>
          {busy ? "Checking…" : "Review and void"}
        </Button>
      </CardContent>
    </Card>
  );
}
