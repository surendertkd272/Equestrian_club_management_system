"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { IndianRupee } from "lucide-react";
import { useFocusTrap } from "@/lib/use-focus-trap";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// A rider's monthly fee, as the coach collected it — for the club's own
// records. No invoice, no cap: fees differ rider to rider. Coaches may use
// this (and only this) money form; see FEE_RECORDER_ROLES.
type Method = "cash" | "upi" | "bank" | "cheque" | "card";
export type EditableFee = {
  id: string;
  amount: number;
  feeMonth: string | null;
  method: string;
  paidAt: string; // YYYY-MM-DD
  note: string;
};

// With `edit`, the same form changes a fee already recorded (finance roles).
export function RecordFeeButton({ riderId, edit }: { riderId: string; edit?: EditableFee }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feeMonth, setFeeMonth] = useState(() => edit?.feeMonth ?? thisMonth());
  const [amount, setAmount] = useState(() => (edit ? String(edit.amount) : ""));
  const [method, setMethod] = useState<Method>(() => (edit?.method as Method) ?? "cash");
  const [paidAt, setPaidAt] = useState(() => edit?.paidAt ?? today());
  const [note, setNote] = useState(() => edit?.note ?? "");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useFocusTrap(ref, open);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && !!feeMonth;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const payload = { amount: value, method, paidAt, feeMonth, ...(note.trim() ? { note: note.trim() } : {}) };
      const res = edit
        ? await fetch(`/api/payments/${edit.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/payments/receipt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ riderId, ...payload }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Couldn't save the fee");
        return;
      }
      toast.success(
        edit ? "Fee updated" : `Monthly fee recorded · ₹${value.toLocaleString("en-IN")}`,
      );
      setOpen(false);
      if (!edit) {
        setAmount("");
        setNote("");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {edit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
        >
          Edit
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          <IndianRupee className="h-3 w-3" /> Record Monthly Fee
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <form
            ref={ref}
            onSubmit={submit}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            role="dialog"
            aria-modal="true"
            aria-label={edit ? "Edit fee" : "Record monthly fee"}
            tabIndex={-1}
            className="absolute left-1/2 top-[15%] z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 space-y-3 rounded-lg border bg-card p-4 shadow-xl outline-none"
          >
            <h2 className="text-base font-semibold">{edit ? "Edit Fee" : "Record Monthly Fee"}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fee for month *</Label>
                <Input aria-label="Fee month" type="month" value={feeMonth} onChange={(e) => setFeeMonth(e.target.value)} />
              </div>
              <div>
                <Label>Amount (₹) *</Label>
                <Input
                  aria-label="Amount (₹)"
                  type="number"
                  min={1}
                  step="1"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <Label>Method</Label>
                <Select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="card">Card</option>
                </Select>
              </div>
              <div>
                <Label>Paid on</Label>
                <Input aria-label="Paid on" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Input
                aria-label="Note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="UPI ref, who paid, anything useful"
                maxLength={200}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !valid}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// "This advance was really the month's fee." Relabels a payment held on the
// rider's account; the amount is untouched.
export function MarkAsFeeButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [feeMonth, setFeeMonth] = useState(thisMonth);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/payments/${paymentId}/fee-month`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeMonth }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Marked as monthly fee");
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded border px-2 py-1 text-[11px] hover:bg-muted"
        title="This was the month's fee, not an advance"
      >
        Mark as monthly fee
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="month"
        aria-label="Fee month"
        value={feeMonth}
        onChange={(e) => setFeeMonth(e.target.value)}
        className="h-7 rounded border border-input bg-background px-1 text-xs"
      />
      <button
        type="button"
        onClick={save}
        disabled={busy || !feeMonth}
        className="rounded border bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:opacity-50"
      >
        {busy ? "…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="px-1 text-[11px] text-muted-foreground">
        Cancel
      </button>
    </span>
  );
}

// Delete a recorded fee, after an inline "are you sure" (no native confirm —
// it is easy to tap through on a phone and invisible to the audit trail).
export function DeleteFeeButton({ paymentId, amount }: { paymentId: string; amount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/payments/${paymentId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(data.invoiceStatus === "due" ? "Payment deleted · invoice is due again" : "Deleted");
      router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
      >
        Delete
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      Delete ₹{Math.round(amount).toLocaleString("en-IN")}?
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="rounded bg-rose-600 px-2 py-1 font-medium text-white disabled:opacity-50"
      >
        {busy ? "…" : "Yes, delete"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="px-1 text-muted-foreground">
        No
      </button>
    </span>
  );
}
