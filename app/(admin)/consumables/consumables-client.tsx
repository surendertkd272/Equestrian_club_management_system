"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeactivateButton } from "@/components/ui/deactivate-button";
import { toast } from "sonner";

export function ConsumablesClient() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "bandage",
    unit: "pad",
    qty: "0",
    reorderThreshold: "10",
    supplier: "",
    storageLocation: "",
  });
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function add() {
    if (!form.name) return toast.error("Name required.");
    setBusy(true);
    try {
      const res = await fetch("/api/consumables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          qty: Number(form.qty),
          reorderThreshold: Number(form.reorderThreshold),
          supplier: form.supplier || undefined,
          storageLocation: form.storageLocation || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success("Added");
      setForm({ name: "", category: "bandage", unit: "pad", qty: "0", reorderThreshold: "10", supplier: "", storageLocation: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a line item</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Sterile gauze pad — 10×10cm" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
              <option value="bandage">Bandage / wrap</option>
              <option value="dressing">Dressing</option>
              <option value="hygiene">Hygiene</option>
              <option value="tool">Tool</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div>
            <Label>Unit</Label>
            <Select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
              <option value="each">each</option>
              <option value="pad">pad</option>
              <option value="roll">roll</option>
              <option value="pack">pack</option>
              <option value="pair">pair</option>
              <option value="bottle">bottle</option>
              <option value="ml">ml</option>
              <option value="g">g</option>
            </Select>
          </div>
          <div>
            <Label>Opening qty</Label>
            <Input type="number" min={0} value={form.qty} onChange={(e) => set("qty", e.target.value)} />
          </div>
          <div>
            <Label>Reorder at</Label>
            <Input type="number" min={0} value={form.reorderThreshold} onChange={(e) => set("reorderThreshold", e.target.value)} />
          </div>
          <div>
            <Label>Supplier (optional)</Label>
            <Input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <Label>Storage location</Label>
            <Input value={form.storageLocation} onChange={(e) => set("storageLocation", e.target.value)} placeholder="Cabinet A2, top shelf" />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={add} disabled={busy}>{busy ? "Adding…" : "Add line item"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function MoveButtons({ id, unit }: { id: string; unit: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function move(direction: "in" | "out", askLabel: string) {
    const raw = window.prompt(`${askLabel} how many ${unit}?`);
    if (!raw) return;
    const qty = parseInt(raw, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Enter a positive integer.");
      return;
    }
    const reason = window.prompt("Reason (optional):") ?? "";
    setBusy(true);
    try {
      const res = await fetch(`/api/consumables/${id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, qty, reason: reason || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data.error === "INSUFFICIENT_STOCK" ? `Only ${data.available} ${unit} available.` :
          (data.error ?? "Failed");
        toast.error(msg);
        return;
      }
      toast.success(`Stock now ${data.qty} ${unit}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => move("in", "Restocked —")}>+ In</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => move("out", "Used —")}>− Out</Button>
      <DeactivateButton apiPath={`/api/consumables/${id}`} />
    </div>
  );
}
