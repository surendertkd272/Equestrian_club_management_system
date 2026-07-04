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

export function NewHorseForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    breed: "",
    sex: "gelding",
    ageYears: "",
    heightIn: "",
    microchip: "",
    efiHorseId: "",
    homeClub: "",
    ownership: "club",
    stableNo: "",
    diet: "",
    // Insurance — all optional
    insurerName: "",
    insurancePolicyNo: "",
    insurancePremium: "",
    insuranceValidFrom: "",
    insuranceValidTo: "",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload: any = { ...form };
    if (form.ageYears === "") delete payload.ageYears;
    if (form.heightIn === "") delete payload.heightIn;
    if (form.insurancePremium === "") delete payload.insurancePremium;
    for (const k of ["insurerName", "insurancePolicyNo", "insuranceValidFrom", "insuranceValidTo", "efiHorseId", "homeClub", "microchip", "breed", "diet", "stableNo"]) {
      if (payload[k] === "") delete payload[k];
    }
    const res = await postJson<{ id: string }>("/api/horses", payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Horse added");
    router.push(`/horses/${res.data.id}`);
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
          <Label>Age (years)</Label>
          <Input aria-label="Age (years)"
            type="number"
            min={0}
            max={50}
            value={form.ageYears}
            onChange={(e) => set("ageYears", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Height (inches)</Label>
          <Input aria-label="Height (inches)"
            type="number"
            step="1"
            min={30}
            max={90}
            value={form.heightIn}
            onChange={(e) => set("heightIn", e.target.value)}
            placeholder="61"
          />
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
        <div className="space-y-1.5">
          <Label>EFI Horse ID</Label>
          <Input aria-label="EFI horse ID"
            value={form.efiHorseId}
            onChange={(e) => set("efiHorseId", e.target.value)}
            placeholder="National registration #"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Home Club</Label>
          <Input aria-label="Home club"
            value={form.homeClub}
            onChange={(e) => set("homeClub", e.target.value)}
            placeholder="If different from this centre"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Dietary Notes</Label>
        <Textarea aria-label="Dietary notes"
          value={form.diet}
          onChange={(e) => set("diet", e.target.value)}
          placeholder="2 kg pellets twice daily, no oats…"
        />
      </div>

      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">
          Insurance (optional)
        </legend>
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
            <Input aria-label="Annual premium (₹)"
              type="number"
              min={0}
              value={form.insurancePremium}
              onChange={(e) => set("insurancePremium", e.target.value)}
            />
          </div>
          <div /> {/* spacer */}
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

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Adding…" : "Add horse"}
      </Button>
    </form>
  );
}
