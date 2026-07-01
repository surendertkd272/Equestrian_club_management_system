"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { patchJson } from "@/lib/client/post-json";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

export type EditHorseInitial = {
  name: string;
  breed: string;
  sex: string;
  ageYears: string;
  heightHh: string;
  microchip: string;
  ownership: string;
  stableNo: string;
  diet: string;
  status: string;
  insurerName: string;
  insurancePolicyNo: string;
  insurancePremium: string;
  insuranceValidFrom: string;
  insuranceValidTo: string;
};

// Mirrors NewHorseForm but PATCHes the existing row. Only the fields the
// PATCH endpoint persists are exposed (efiHorseId / homeClub are set at
// creation only). Empty strings are dropped so a cleared field becomes null.
export function EditHorseForm({ horseId, initial }: { horseId: string; initial: EditHorseInitial }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedChanges(dirty && !saving);

  function set<K extends keyof EditHorseInitial>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload: Record<string, unknown> = { ...form };
    // Numeric/optional fields: drop blanks so they clear to null server-side.
    for (const k of ["ageYears", "heightHh", "insurancePremium"]) {
      if (payload[k] === "") delete payload[k];
    }
    const res = await patchJson(`/api/horses/${horseId}`, payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Horse updated");
    router.push(`/horses/${horseId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Name *</Label>
          <Input aria-label="Name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Breed</Label>
          <Input aria-label="Breed" value={form.breed} onChange={(e) => set("breed", e.target.value)} placeholder="Marwari, Sindhi…" />
        </div>
        <div className="space-y-1.5">
          <Label>Sex</Label>
          <Select aria-label="Sex" value={form.sex} onChange={(e) => set("sex", e.target.value)}>
            <option value="mare">Mare</option>
            <option value="gelding">Gelding</option>
            <option value="stallion">Stallion</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select aria-label="Status" value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Active</option>
            <option value="rest">Rest</option>
            <option value="retired">Retired</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Age (years)</Label>
          <Input aria-label="Age (years)" type="number" min={0} max={50} value={form.ageYears} onChange={(e) => set("ageYears", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Height (hh)</Label>
          <Input aria-label="Height (hh)" type="number" step="0.1" min={8} max={20} value={form.heightHh} onChange={(e) => set("heightHh", e.target.value)} placeholder="15.1" />
        </div>
        <div className="space-y-1.5">
          <Label>Ownership</Label>
          <Select aria-label="Ownership" value={form.ownership} onChange={(e) => set("ownership", e.target.value)}>
            <option value="club">Club</option>
            <option value="private">Private</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Stable #</Label>
          <Input aria-label="Stable #" value={form.stableNo} onChange={(e) => set("stableNo", e.target.value)} placeholder="A1" />
        </div>
        <div className="space-y-1.5">
          <Label>Microchip</Label>
          <Input aria-label="Microchip" value={form.microchip} onChange={(e) => set("microchip", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Dietary Notes</Label>
        <Textarea aria-label="Dietary notes" value={form.diet} onChange={(e) => set("diet", e.target.value)} placeholder="2 kg pellets twice daily, no oats…" />
      </div>

      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">Insurance (optional)</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Insurer</Label>
            <Input aria-label="Insurer" value={form.insurerName} onChange={(e) => set("insurerName", e.target.value)} placeholder="Bajaj Allianz" />
          </div>
          <div className="space-y-1.5">
            <Label>Policy #</Label>
            <Input aria-label="Policy #" value={form.insurancePolicyNo} onChange={(e) => set("insurancePolicyNo", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Annual Premium (₹)</Label>
            <Input aria-label="Annual premium (₹)" type="number" min={0} value={form.insurancePremium} onChange={(e) => set("insurancePremium", e.target.value)} />
          </div>
          <div />
          <div className="space-y-1.5">
            <Label>Valid From</Label>
            <Input aria-label="Valid from" type="date" value={form.insuranceValidFrom} onChange={(e) => set("insuranceValidFrom", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Valid To</Label>
            <Input aria-label="Valid to" type="date" value={form.insuranceValidTo} onChange={(e) => set("insuranceValidTo", e.target.value)} />
          </div>
        </div>
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/horses/${horseId}`)}>Cancel</Button>
      </div>
    </form>
  );
}
