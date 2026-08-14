"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { patchJson } from "@/lib/client/post-json";

// Record what happened to an invoice.
//
// Collection is manual — payment lands in a bank account, not in the app — so
// without this every issued invoice sits "due" forever and the "Paid · last
// 30d" figure on this page reads zero regardless of what was actually
// received. A number that is confidently wrong is worse than one that is
// missing.
//
// Asks for a reference on the paid path so a row can be reconciled against a
// bank statement later; skipping it is allowed, because a payment you can see
// but can't reference is still better recorded than not.
export function SettleButton({
  invoiceId,
  number,
  total,
}: {
  invoiceId: string;
  number: string;
  total: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  async function settle(status: "paid" | "void") {
    setBusy(true);
    const res = await patchJson(`/api/owner/saas-invoices/${invoiceId}`, {
      status,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(status === "paid" ? `${number} marked paid` : `${number} voided`);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Record
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Record outcome for ${number}`}
        className="w-full max-w-sm rounded-lg border bg-card p-4 shadow-xl"
      >
        <h2 className="font-semibold">{number}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          ₹{total.toLocaleString("en-IN")} including GST.
        </p>

        <div className="mt-3 space-y-1.5">
          <label htmlFor="settle-ref" className="text-xs text-muted-foreground">
            Payment reference (optional)
          </label>
          <Input
            id="settle-ref"
            autoFocus
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UTR / UPI ref / cheque no."
            className="h-8"
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {/* Void is destructive-looking on purpose: it means "this invoice
                should never have existed", not "we didn't get paid". */}
            <Button size="sm" variant="outline" onClick={() => settle("void")} disabled={busy}>
              Void
            </Button>
            <Button size="sm" onClick={() => settle("paid")} disabled={busy}>
              {busy ? "Saving…" : "Mark paid"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
