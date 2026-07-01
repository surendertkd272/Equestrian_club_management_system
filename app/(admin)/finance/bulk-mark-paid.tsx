"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

// Tickable list of due invoices. On submit, fires one POST that creates
// a full-remaining-amount Payment row per ticked invoice. Skips already-
// paid rows server-side, so optimistic UI is safe.
export function BulkMarkPaid({
  dueInvoices,
}: {
  dueInvoices: { id: string; label: string; outstanding: number }[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<"cash" | "upi" | "bank" | "cheque" | "card">("cash");
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setPicked((prev) => (prev.size === dueInvoices.length ? new Set() : new Set(dueInvoices.map((d) => d.id))));
  }

  const totalPicked = dueInvoices
    .filter((d) => picked.has(d.id))
    .reduce((s, d) => s + d.outstanding, 0);

  async function run() {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/invoices/bulk-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: Array.from(picked), method }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Failed");
        return;
      }
      const msg = d.skipped?.length
        ? `Marked ${d.marked} paid · ${d.skipped.length} skipped`
        : `Marked ${d.marked} invoices paid`;
      toast.success(msg);
      setPicked(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (dueInvoices.length === 0) return null;

  return (
    <details className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">
        Bulk mark paid <span className="text-xs text-muted-foreground">({dueInvoices.length} due)</span>
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={toggleAll}
            className="text-primary hover:underline"
          >
            {picked.size === dueInvoices.length ? "Clear selection" : "Select all"}
          </button>
          <span className="text-muted-foreground">
            {picked.size} selected · ₹{totalPicked.toFixed(2)}
          </span>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border bg-card">
          {dueInvoices.map((d) => (
            <label
              key={d.id}
              className="flex cursor-pointer items-center justify-between gap-2 border-b px-3 py-1.5 text-xs last:border-0 hover:bg-muted/40"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(d.id)}
                  onChange={() => toggle(d.id)}
                />
                <span>{d.label}</span>
              </div>
              <span className="font-mono">₹{d.outstanding.toFixed(2)}</span>
            </label>
          ))}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">
            <label className="text-xs uppercase text-muted-foreground">Method</label>
            <Select value={method} onChange={(e) => setMethod(e.target.value as any)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank">Bank Transfer</option>
              <option value="cheque">Cheque</option>
              <option value="card">Card</option>
            </Select>
          </div>
          <Button onClick={run} disabled={busy || picked.size === 0} size="sm">
            {busy ? "Marking…" : `Mark ${picked.size} paid`}
          </Button>
        </div>
      </div>
    </details>
  );
}
