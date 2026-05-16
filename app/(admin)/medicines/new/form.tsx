"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Centre = { id: string; name: string };

export function NewMedicineForm({
  centres = [],
  isSuperAdmin = false,
}: {
  centres?: Centre[];
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const todayPlus1y = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    name: "",
    generic: "",
    category: "nsaid",
    schedule: "none",
    batchNo: "",
    mfgDate: "",
    expDate: todayPlus1y,
    qty: "10",
    reorderThreshold: "5",
    supplier: "",
    storageLocation: "",
    coldChain: false,
    // Only used when SUPER_ADMIN is creating; the API picks session.centreId
    // when this is blank.
    centreId: "",
  });

  function set<K extends keyof typeof form>(k: K, v: string | boolean) {
    setForm((f) => ({ ...f, [k]: v as any }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSuperAdmin && !form.centreId) {
      toast.error("Pick a centre — super admins aren't scoped to one.");
      return;
    }
    setSaving(true);
    const payload: any = { ...form };
    if (!form.mfgDate) delete payload.mfgDate;
    if (!payload.centreId) delete payload.centreId;
    const res = await fetch("/api/medicines", {
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
    const data = await res.json();
    toast.success("Medicine added");
    router.push(`/medicines/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {isSuperAdmin && (
        <div className="rounded-md border bg-muted/30 p-3">
          <Label>Centre *</Label>
          <Select value={form.centreId} onChange={(e) => set("centreId", e.target.value)} required>
            <option value="">— Pick which club this batch goes to —</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            You're signed in as HQ super admin — medicines live per-centre, so pick the cabinet.
          </p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Name *</Label>
          <Input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Flunixin Meglumine" />
        </div>
        <div className="space-y-1.5">
          <Label>Generic</Label>
          <Input value={form.generic} onChange={(e) => set("generic", e.target.value)} placeholder="Flunixin" />
        </div>
        <div className="space-y-1.5">
          <Label>Category *</Label>
          <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
            <option value="nsaid">NSAID — pain/inflammation (Flunixin, Bute, Firocoxib)</option>
            <option value="antibiotic">Antibiotic (incl. eye antibiotic)</option>
            <option value="antihistamine">Antihistamine</option>
            <option value="sedative">Sedative</option>
            <option value="wound">Wound care (silver spray, antiseptic)</option>
            <option value="eye">Eye ointment / drops</option>
            <option value="gastric">Gastric (Omeprazole)</option>
            <option value="electrolyte">Electrolyte</option>
            <option value="supplement">Supplement</option>
            <option value="vaccine">Vaccine</option>
            <option value="antitoxin">Antitoxin (Tetanus antitoxin)</option>
            <option value="dewormer">Dewormer</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Schedule</Label>
          <Select value={form.schedule} onChange={(e) => set("schedule", e.target.value)}>
            <option value="none">—</option>
            <option value="schedule_h">Schedule H</option>
            <option value="schedule_x">Schedule X</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Batch # *</Label>
          <Input required value={form.batchNo} onChange={(e) => set("batchNo", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Supplier</Label>
          <Input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Mfg date</Label>
          <Input type="date" value={form.mfgDate} onChange={(e) => set("mfgDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Expiry date *</Label>
          <Input required type="date" value={form.expDate} onChange={(e) => set("expDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Qty in stock *</Label>
          <Input required type="number" min={0} value={form.qty} onChange={(e) => set("qty", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Reorder threshold *</Label>
          <Input
            required
            type="number"
            min={0}
            value={form.reorderThreshold}
            onChange={(e) => set("reorderThreshold", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Storage location</Label>
          <Input
            value={form.storageLocation}
            onChange={(e) => set("storageLocation", e.target.value)}
            placeholder="Vet cabinet A / Cold storage"
          />
        </div>
        <label className="mt-7 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.coldChain}
            onChange={(e) => set("coldChain", e.target.checked)}
          />
          Cold-chain required (2–8°C)
        </label>
      </div>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Adding…" : "Add medicine"}
      </Button>
    </form>
  );
}
