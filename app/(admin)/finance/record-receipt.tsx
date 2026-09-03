"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

// Record fees received, with no invoice behind them.
//
// The gap this fills, in the client's own words: "koi ₹1000 fees pay karta
// hai, koi ₹2 lakh ... main apne dashboard pe kaise dekhunga ki is mahine
// mere paas itna revenue aaya hai?" A club that collects privately had
// nowhere to enter that, so its revenue read zero however much it banked.
//
// No amount ceiling. The old flow capped a payment at the invoice total,
// which assumed every fee was the same ₹3,000 registration charge.
export function RecordReceipt({
  riders,
}: {
  riders: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [riderId, setRiderId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "upi" | "bank" | "cheque" | "card">("cash");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Proof of the money arriving. For a club collecting privately this is the
  // only evidence the payment happened — there is no gateway record behind it.
  const [proofUrl, setProofUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  async function uploadProof(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "payment_proof");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        toast.error(data.message ?? data.error ?? "Couldn't upload that file");
        return;
      }
      setProofUrl(data.url);
      toast.success("Proof attached");
    } finally {
      setUploading(false);
    }
  }

  const value = Number(amount);
  const valid = riderId !== "" && Number.isFinite(value) && value > 0;

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/payments/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riderId,
          amount: value,
          method,
          paidAt: new Date(paidAt).toISOString(),
          note: note.trim() || undefined,
          proofUrl: proofUrl || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Couldn't record it");
        return;
      }
      toast.success(`Recorded ₹${value.toLocaleString("en-IN")}`);
      setAmount("");
      setNote("");
      setProofUrl("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Record fees received</CardTitle>
        <CardDescription>
          For money collected directly — cash, UPI, bank transfer — with no invoice raised. It
          counts towards this month&apos;s revenue immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1 lg:col-span-2">
          <label htmlFor="rcpt-rider" className="text-xs text-muted-foreground">Rider</label>
          <Select id="rcpt-rider" value={riderId} onChange={(e) => setRiderId(e.target.value)}>
            <option value="">— Select —</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="rcpt-amount" className="text-xs text-muted-foreground">Amount (₹)</label>
          {/* No max. Fees range from a thousand to a couple of lakh, and the
              previous flow capped every payment at the invoice total. */}
          <Input
            id="rcpt-amount"
            type="number"
            min={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 150000"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="rcpt-method" className="text-xs text-muted-foreground">Method</label>
          <Select id="rcpt-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="card">Card</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="rcpt-date" className="text-xs text-muted-foreground">Received on</label>
          <Input id="rcpt-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4">
          <label htmlFor="rcpt-note" className="text-xs text-muted-foreground">
            Note (optional) — what the money was for
          </label>
          <Input
            id="rcpt-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Annual membership + 3 months coaching"
            maxLength={300}
          />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-4">
          <label htmlFor="rcpt-proof" className="text-xs text-muted-foreground">
            Proof (optional) — UPI screenshot, bank slip or scanned receipt
          </label>
          <input
            id="rcpt-proof"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => uploadProof(e.target.files?.[0] ?? null)}
            disabled={uploading}
            className="block w-full text-sm"
          />
          {uploading && <p className="text-xs text-muted-foreground">Uploading…</p>}
          {proofUrl && (
            <p className="text-xs">
              <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                Proof attached — view
              </a>
            </p>
          )}
        </div>
        <div className="flex items-end">
          <Button onClick={submit} disabled={busy || uploading || !valid} className="w-full">
            {busy ? "Saving…" : "Record"}
          </Button>
        </div>
        {method === "cheque" && (
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">
            A cheque is recorded but not counted as cleared — mark it cleared when it clears, so a
            bounced cheque doesn&apos;t overstate the month.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
