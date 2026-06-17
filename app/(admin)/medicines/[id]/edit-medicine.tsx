"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { patchJson } from "@/lib/client/post-json";

export type EditableMedicine = {
  id: string;
  name: string;
  generic: string | null;
  category: string;
  schedule: string | null;
  batchNo: string;
  mfgDate: string; // YYYY-MM-DD or ""
  expDate: string; // YYYY-MM-DD
  qty: number;
  reorderThreshold: number;
  supplier: string | null;
  storageLocation: string | null;
  coldChain: boolean;
};

// Edit an existing medicine's details. PATCHes /api/medicines/[id]
// (permission: medicine.manage). Collapsed to a button until opened.
export function EditMedicineForm({ med }: { med: EditableMedicine }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: med.name,
    generic: med.generic ?? "",
    category: med.category,
    schedule: med.schedule ?? "none",
    batchNo: med.batchNo,
    mfgDate: med.mfgDate,
    expDate: med.expDate,
    qty: String(med.qty),
    reorderThreshold: String(med.reorderThreshold),
    supplier: med.supplier ?? "",
    storageLocation: med.storageLocation ?? "",
    coldChain: med.coldChain,
  });

  function set<K extends keyof typeof form>(k: K, v: string | boolean) {
    setForm((f) => ({ ...f, [k]: v as never }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload: Record<string, unknown> = { ...form };
    if (!form.mfgDate) delete payload.mfgDate;
    const res = await patchJson(`/api/medicines/${med.id}`, payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Medicine updated");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" /> Edit details
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Name *</Label>
          <Input aria-label="Name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Generic</Label>
          <Input aria-label="Generic" value={form.generic} onChange={(e) => set("generic", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Category *</Label>
          <Select aria-label="Category" value={form.category} onChange={(e) => set("category", e.target.value)}>
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
          <Select aria-label="Schedule" value={form.schedule} onChange={(e) => set("schedule", e.target.value)}>
            <option value="none">—</option>
            <option value="schedule_h">Schedule H</option>
            <option value="schedule_x">Schedule X</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Batch # *</Label>
          <Input aria-label="Batch #" required value={form.batchNo} onChange={(e) => set("batchNo", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Supplier</Label>
          <Input aria-label="Supplier" value={form.supplier} onChange={(e) => set("supplier", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Mfg date</Label>
          <Input aria-label="Mfg date" type="date" value={form.mfgDate} onChange={(e) => set("mfgDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Expiry date *</Label>
          <Input aria-label="Expiry date" required type="date" value={form.expDate} onChange={(e) => set("expDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Qty in stock *</Label>
          <Input aria-label="Qty in stock" required type="number" min={0} value={form.qty} onChange={(e) => set("qty", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Reorder threshold *</Label>
          <Input aria-label="Reorder threshold"
            required
            type="number"
            min={0}
            value={form.reorderThreshold}
            onChange={(e) => set("reorderThreshold", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Storage location</Label>
          <Input aria-label="Storage location" value={form.storageLocation} onChange={(e) => set("storageLocation", e.target.value)} />
        </div>
        <label className="mt-7 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.coldChain} onChange={(e) => set("coldChain", e.target.checked)} />
          Cold-chain required (2–8°C)
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
