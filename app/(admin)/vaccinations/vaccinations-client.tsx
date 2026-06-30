"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Horse = { id: string; name: string; stableNo: string | null };

// Grouped by purpose so the picker doesn't dump 11 unrelated items into
// one flat list. Group label is rendered as <optgroup>.
const PRESET_GROUPS: { group: string; items: { key: string; label: string; interval: number }[] }[] = [
  {
    group: "Vaccines",
    items: [
      { key: "tetanus", label: "Equine Tetanus Toxoid", interval: 365 },
      { key: "ehv", label: "EHV-1/4 (Rhinopneumonitis)", interval: 180 },
      { key: "influenza", label: "Equine Influenza", interval: 180 },
      { key: "rabies", label: "Rabies", interval: 365 },
      { key: "rhinopneumonitis", label: "Rhinopneumonitis", interval: 180 },
    ],
  },
  {
    group: "Deworming",
    items: [
      { key: "deworm_ivermectin", label: "Deworm · Ivermectin", interval: 90 },
      { key: "deworm_strongid", label: "Deworm · Strongid (pyrantel)", interval: 60 },
      { key: "deworm_panacur", label: "Deworm · Panacur (fenbendazole)", interval: 180 },
    ],
  },
  {
    group: "Dental",
    items: [
      { key: "dental_check", label: "Dental check", interval: 180 },
      { key: "dental_float", label: "Dental float", interval: 365 },
    ],
  },
];

const VACCINE_PRESETS = PRESET_GROUPS.flatMap((g) => g.items);

export function VaccinationsClient({ horses }: { horses: Horse[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    horseId: horses[0]?.id ?? "",
    vaccineKey: "tetanus",
    vaccineLabel: "Equine Tetanus Toxoid",
    intervalDays: "365",
    lastGivenAt: "",
    nextDueAt: "",
  });
  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function applyPreset(key: string) {
    const p = VACCINE_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setForm((f) => ({ ...f, vaccineKey: key, vaccineLabel: p.label, intervalDays: String(p.interval) }));
  }

  async function save() {
    if (!form.horseId) return toast.error("Pick a horse.");
    setBusy(true);
    try {
      const payload: any = {
        horseId: form.horseId,
        vaccineKey: form.vaccineKey,
        vaccineLabel: form.vaccineLabel,
        intervalDays: Number(form.intervalDays),
      };
      if (form.lastGivenAt) payload.lastGivenAt = form.lastGivenAt;
      if (form.nextDueAt) payload.nextDueAt = form.nextDueAt;

      const res = await fetch("/api/vaccinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Schedule saved");
      setForm((f) => ({ ...f, lastGivenAt: "", nextDueAt: "" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add / update schedule</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Horse</Label>
            <Select aria-label="Horse" value={form.horseId} onChange={(e) => set("horseId", e.target.value)}>
              {horses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}{h.stableNo ? ` (${h.stableNo})` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select aria-label="Type"
              value={form.vaccineKey}
              onChange={(e) => {
                applyPreset(e.target.value);
                if (e.target.value === "custom") set("vaccineLabel", "");
              }}
            >
              {PRESET_GROUPS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </optgroup>
              ))}
              <option value="custom">Custom…</option>
            </Select>
          </div>
          <div>
            <Label>Label</Label>
            <Input aria-label="Label" value={form.vaccineLabel} onChange={(e) => set("vaccineLabel", e.target.value)} />
          </div>
          <div>
            <Label>Interval (days)</Label>
            <Input aria-label="Interval (days)"
              type="number"
              min={7}
              value={form.intervalDays}
              onChange={(e) => set("intervalDays", e.target.value)}
            />
          </div>
          <div>
            <Label>Last given (optional)</Label>
            <Input aria-label="Last given (optional)" type="date" value={form.lastGivenAt} onChange={(e) => set("lastGivenAt", e.target.value)} />
          </div>
          <div>
            <Label>Next due (auto if blank)</Label>
            <Input aria-label="Next due (auto if blank)" type="date" value={form.nextDueAt} onChange={(e) => set("nextDueAt", e.target.value)} />
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save schedule"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function RecordDoseButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    const ok = await openConfirm({
      title: "Record dose given today?",
      body: "Next-due rolls forward by the configured interval.",
      confirmLabel: "Record dose",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/vaccinations/${id}/dose`, { method: "POST", body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Dose recorded");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={go} disabled={busy}>
      {busy ? "…" : "Record dose"}
    </Button>
  );
}
