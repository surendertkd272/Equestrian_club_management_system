"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

// Raise a due by hand.
//
// Dues previously only appeared from enrolment approval and event entry, so a
// club could record what the system happened to generate and nothing else — no
// monthly coaching fee, no one-off charge.
//
// Recording a due never contacts the family. Where the club has parent-facing
// payments switched off, this is purely an entry in its own books.
export function RaiseDue({ riders }: { riders: { id: string; name: string }[] }) {
  const router = useRouter();
  const [riderId, setRiderId] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"monthly" | "registration" | "exam" | "event" | "other">("monthly");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const valid = riderId !== "" && Number.isFinite(value) && value > 0;

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riderId,
          amount: value,
          kind,
          dueDate: new Date(dueDate).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Couldn't raise it");
        return;
      }
      toast.success(`Due of ₹${value.toLocaleString("en-IN")} recorded`);
      setAmount("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Raise a due</CardTitle>
        <CardDescription>
          Record what a rider owes — a coaching month, an exam fee, a one-off charge. Nothing is
          sent to the family.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1 lg:col-span-2">
          <label htmlFor="due-rider" className="text-xs text-muted-foreground">Rider</label>
          <Select id="due-rider" value={riderId} onChange={(e) => setRiderId(e.target.value)}>
            <option value="">— Select —</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="due-amount" className="text-xs text-muted-foreground">Amount (₹)</label>
          <Input
            id="due-amount"
            type="number"
            min={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 5000"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="due-kind" className="text-xs text-muted-foreground">For</label>
          <Select id="due-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="monthly">Monthly fee</option>
            <option value="registration">Registration</option>
            <option value="exam">Exam</option>
            <option value="event">Event</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="due-date" className="text-xs text-muted-foreground">Due on</label>
          <Input id="due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="flex items-end lg:col-span-5">
          <Button onClick={submit} disabled={busy || !valid}>
            {busy ? "Saving…" : "Raise due"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
