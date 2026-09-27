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
  label = "Record Payment",
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
  // Where money above the invoice goes. At this club it is nearly always the
  // month's fee paid in the same transfer, so that is the default; "advance"
  // is for money genuinely held against future bills.
  const [excessAs, setExcessAs] = useState<"fee" | "advance">("fee");
  const [feeMonth, setFeeMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  useFocusTrap(dialogRef, open);

  const entered = Number(amount);
  // Anything above what this invoice still owes. Shown before submit, so the
  // operator sees exactly where the extra goes rather than discovering it.
  const excess = Number.isFinite(entered) ? Math.round((entered - outstanding) * 100) / 100 : 0;
  const hasExcess = excess > 0.001;
  const inr = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          amount: entered,
          method,
          ...(txnRef ? { txnRef } : {}),
          ...(hasExcess ? { excessAsAdvance: true } : {}),
          ...(hasExcess && excessAs === "fee" && feeMonth ? { excessFeeMonth: feeMonth } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error === "OVERPAY" || data.error === "DUPLICATE_REF"
            ? data.message
            : data.error === "INVOICE_REFUNDED"
              ? "This invoice was refunded — can't record a payment."
              : data.error ?? "Failed",
        );
        return;
      }
      toast.success(
        data.advanceAmount > 0
          ? data.excessFeeMonth
            ? `Invoice fully paid · ${inr(data.advanceAmount)} recorded as the monthly fee`
            : `Invoice fully paid · ${inr(data.advanceAmount)} kept as advance on account`
          : data.invoiceStatus === "paid"
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
        className="inline-flex items-center gap-1 rounded border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
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
            <h2 className="text-base font-semibold">Record Payment</h2>
            <div className="text-xs text-muted-foreground">
              Outstanding: ₹{outstanding.toFixed(2)}
            </div>
            <div>
              <Label>Amount (₹) *</Label>
              {/* No max: a family paying registration and the month's fee in
                  one transfer is normal. The overflow is shown below and filed
                  as that month's fee (or an advance) rather than refused. */}
              <Input aria-label="Amount (₹)"
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
              {hasExcess && (
                <fieldset className="mt-1.5 space-y-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <legend className="sr-only">What is the extra for?</legend>
                  <p>
                    {inr(outstanding)} settles this invoice. The other <strong>{inr(excess)}</strong> is:
                  </p>
                  <label className="flex flex-wrap items-center gap-2">
                    <input
                      type="radio"
                      name="excessAs"
                      checked={excessAs === "fee"}
                      onChange={() => setExcessAs("fee")}
                    />
                    Monthly fee for
                    <input
                      type="month"
                      aria-label="Fee month"
                      value={feeMonth}
                      onChange={(e) => { setFeeMonth(e.target.value); setExcessAs("fee"); }}
                      className="h-7 rounded border border-input bg-background px-1 text-xs text-foreground"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="excessAs"
                      checked={excessAs === "advance"}
                      onChange={() => setExcessAs("advance")}
                    />
                    An advance, kept on the rider&apos;s account
                  </label>
                </fieldset>
              )}
            </div>
            <div>
              <Label>Method</Label>
              <Select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value as any)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="card">Card</option>
              </Select>
            </div>
            <div>
              <Label>Reference (Optional)</Label>
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
              <Button type="submit" disabled={busy || Number(amount) <= 0 || (hasExcess && excessAs === "fee" && !feeMonth)}>
                {busy ? "Saving…" : "Record"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
