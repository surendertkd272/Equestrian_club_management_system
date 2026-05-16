"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Maintenance({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ issue: "", vendor: "", cost: "", scheduledAt: "" });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload: any = { issue: form.issue, vendor: form.vendor || undefined };
    if (form.cost) payload.cost = form.cost;
    if (form.scheduledAt) payload.scheduledAt = form.scheduledAt;
    const res = await fetch(`/api/assets/${assetId}/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed");
      return;
    }
    toast.success("Maintenance opened");
    setForm({ issue: "", vendor: "", cost: "", scheduledAt: "" });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 border-t pt-4 md:grid-cols-4 md:items-end">
      <div className="md:col-span-2 space-y-1.5">
        <Label>Issue *</Label>
        <Input
          required
          value={form.issue}
          onChange={(e) => set("issue", e.target.value)}
          placeholder="Stirrup leather frayed"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Vendor</Label>
        <Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Star Saddlery" />
      </div>
      <div className="space-y-1.5">
        <Label>Est. cost (₹)</Label>
        <Input type="number" min={0} value={form.cost} onChange={(e) => set("cost", e.target.value)} />
      </div>
      <div className="md:col-span-4">
        <Button type="submit" disabled={saving} variant="outline" className="w-full md:w-auto">
          {saving ? "Opening…" : "Open repair ticket"}
        </Button>
      </div>
    </form>
  );
}
