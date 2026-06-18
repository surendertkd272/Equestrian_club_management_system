"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Wallet } from "lucide-react";
import { useFocusTrap } from "@/lib/use-focus-trap";

// Modal-style record-payment button. Drops onto any invoice row. On
// success, the parent route refreshes so the new payment shows up in the
// statement immediately.
export function RecordPaymentButton({
  invoiceId,
  outstanding,
  label = "Record payment",
}: {
  invoiceId: string;
  // Outstanding amount in INR — used to default the input and stop
  // accidental over-payment before the server even sees it.
  outstanding: number;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(outstanding.toFixed(2));
  const [method, setMethod] = useState<"cash" | "cheque" | "upi" | "bank" | "card">("cash");
  const [txnRef, setTxnRef] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  useFocusTrap(dialogRef, open);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          amount: Number(amount),
          method,
          ...(txnRef ? { txnRef } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error === "OVERPAY"
            ? data.message
            : data.error === "INVOICE_REFUNDED"
              ? "This invoice was refunded — can't record a payment."
              : data.error ?? "Failed",
        );
        return;
      }
      toast.success(
        data.invoiceStatus === "paid"
          ? "Payment recorded — invoice fully paid"
          : `Payment recorded · ₹${data.outstanding.toFixed(2)} still outstanding`,
      );
      setOpen(false);
      setTxnRef("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (outstanding <= 0.001) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border bg-card px-2 py-0.5 text-xs hover:bg-muted"
      >
        <Wallet className="h-3 w-3" /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <form
            ref={dialogRef}
            onSubmit={submit}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            role="dialog"
            aria-modal="true"
            aria-label="Record payment"
            tabIndex={-1}
            className="absolute left-1/2 top-1/4 z-50 w-full max-w-sm -translate-x-1/2 space-y-3 rounded-lg border bg-card p-4 shadow-xl outline-none"
          >
            <h2 className="text-base font-semibold">Record payment</h2>
            <div className="text-xs text-muted-foreground">
              Outstanding: ₹{outstanding.toFixed(2)}
            </div>
            <div>
              <Label>Amount (₹) *</Label>
              <Input aria-label="Amount (₹)"
                type="number"
                min={0.01}
                step="0.01"
                max={outstanding}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label>Method</Label>
              <Select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value as any)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="card">Card</option>
              </Select>
            </div>
            <div>
              <Label>Reference (optional)</Label>
              <Input aria-label="Reference (optional)"
                value={txnRef}
                onChange={(e) => setTxnRef(e.target.value)}
                placeholder="UPI ref / cheque no / receipt no"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || Number(amount) <= 0}>
                {busy ? "Saving…" : "Record"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
