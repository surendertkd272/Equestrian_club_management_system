"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/client/post-json";

export function PrescribeForm({
  medicineId,
  horses,
  maxQty,
}: {
  medicineId: string;
  horses: { id: string; name: string }[];
  maxQty: number;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  // Idempotency key for the CURRENT logical submit: a double-click or network
  // retry re-sends the same key (server dedups); rotated only after success
  // so the next prescription is a fresh request.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    horseId: horses[0]?.id ?? "",
    dose: "",
    route: "im",
    reason: "",
    withdrawalDays: "0",
    qtyConsumed: "1",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await postJson<{ newQty: number; withdrawalUntil?: string | null; lowStock?: boolean }>(
      `/api/medicines/${medicineId}/usage`,
      { ...form, requestKey },
    );
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    const data = res.data;
    const parts = [`Stock now ${data.newQty}`];
    if (data.withdrawalUntil) parts.push(`Horse on rest until ${new Date(data.withdrawalUntil).toLocaleDateString("en-IN")}`);
    if (data.lowStock) parts.push("LOW STOCK — reorder");
    toast.success("Prescribed · " + parts.join(" · "));
    setForm((f) => ({ ...f, dose: "", reason: "" }));
    setRequestKey(crypto.randomUUID()); // next prescription = new logical request
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1.5">
        <Label>Horse *</Label>
        <Select aria-label="Horse" value={form.horseId} onChange={(e) => set("horseId", e.target.value)} required>
          {horses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Dose *</Label>
        <Input aria-label="Dose"
          required
          value={form.dose}
          onChange={(e) => set("dose", e.target.value)}
          placeholder="1.1 mg/kg · 10 ml"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Route *</Label>
        <Select aria-label="Route" value={form.route} onChange={(e) => set("route", e.target.value)}>
          <option value="oral">Oral</option>
          <option value="im">Intramuscular</option>
          <option value="iv">Intravenous</option>
          <option value="subcutaneous">Subcutaneous</option>
          <option value="topical">Topical</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Withdrawal (days)</Label>
        <Input aria-label="Withdrawal (days)"
          type="number"
          min={0}
          max={120}
          value={form.withdrawalDays}
          onChange={(e) => set("withdrawalDays", e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">
          Sets horse to <code>rest</code> if &gt; 0 — blocks lessons + competition allocation until cleared.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Qty consumed</Label>
        <Input aria-label="Qty consumed"
          type="number"
          min={1}
          max={maxQty}
          value={form.qtyConsumed}
          onChange={(e) => set("qtyConsumed", e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">In stock: {maxQty}</p>
      </div>
      <div className="md:col-span-1" />
      <div className="md:col-span-3 space-y-1.5">
        <Label>Reason / notes</Label>
        <Textarea aria-label="Reason / notes"
          rows={2}
          value={form.reason}
          onChange={(e) => set("reason", e.target.value)}
          placeholder="Lameness LF · post-jumping lesson"
        />
      </div>
      <div className="md:col-span-3">
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Saving…" : "Prescribe & log"}
        </Button>
      </div>
    </form>
  );
}
