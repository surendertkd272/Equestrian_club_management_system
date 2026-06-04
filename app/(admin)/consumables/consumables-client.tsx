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
        toast.error(data.message ?? data.error ?? "Failed");
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

export type EditableConsumable = {
  id: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  reorderThreshold: number;
  supplier: string | null;
  storageLocation: string | null;
};

// Edit a consumable line item's details (PATCH /api/consumables/[id]).
export function EditConsumable({ row }: { row: EditableConsumable }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: row.name,
    category: row.category,
    unit: row.unit,
    qty: String(row.qty),
    reorderThreshold: String(row.reorderThreshold),
    supplier: row.supplier ?? "",
    storageLocation: row.storageLocation ?? "",
  });
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.name.trim()) return toast.error("Name required.");
    setBusy(true);
    try {
      const res = await fetch(`/api/consumables/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category,
          unit: form.unit,
          qty: Number(form.qty),
          reorderThreshold: Number(form.reorderThreshold),
          supplier: form.supplier || undefined,
          storageLocation: form.storageLocation || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Failed");
        return;
      }
      toast.success("Updated");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Edit</Button>
    );
  }
  return (
    <div className="mt-2 grid gap-2 rounded-md border bg-card p-3 text-left sm:grid-cols-3">
      <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
      <div>
        <Label className="text-xs">Category</Label>
        <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
          <option value="bandage">Bandage / wrap</option>
          <option value="dressing">Dressing</option>
          <option value="hygiene">Hygiene</option>
          <option value="tool">Tool</option>
          <option value="other">Other</option>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Unit</Label>
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
      <div><Label className="text-xs">Qty</Label><Input type="number" min={0} value={form.qty} onChange={(e) => set("qty", e.target.value)} /></div>
      <div><Label className="text-xs">Reorder at</Label><Input type="number" min={0} value={form.reorderThreshold} onChange={(e) => set("reorderThreshold", e.target.value)} /></div>
      <div><Label className="text-xs">Supplier</Label><Input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} /></div>
      <div className="sm:col-span-3"><Label className="text-xs">Storage location</Label><Input value={form.storageLocation} onChange={(e) => set("storageLocation", e.target.value)} /></div>
      <div className="flex gap-2 sm:col-span-3">
        <Button size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
