"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const SCOPES = [
  { value: "internal", label: "Internal" },
  { value: "inter_school", label: "Inter-school" },
  { value: "state", label: "State" },
  { value: "national", label: "National" },
];

export type EditCompetitionInitial = {
  name: string;
  venue: string;
  scope: string;
  entryDeadline: string;
};

export function EditCompetitionForm({ competitionId, initial }: { competitionId: string; initial: EditCompetitionInitial }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  function set<K extends keyof EditCompetitionInitial>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/competitions/${competitionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        venue: form.venue || null,
        scope: form.scope,
        entryDeadline: form.entryDeadline || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Failed to save");
      return;
    }
    toast.success("Competition updated");
    router.push(`/competitions/${competitionId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>Name *</Label>
          <Input required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <Label>Venue</Label>
          <Input value={form.venue} onChange={(e) => set("venue", e.target.value)} placeholder="Bangalore Turf Club" />
        </div>
        <div>
          <Label>Scope</Label>
          <Select value={form.scope} onChange={(e) => set("scope", e.target.value)}>
            {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>
        <div>
          <Label>Entry deadline</Label>
          <Input type="date" value={form.entryDeadline} onChange={(e) => set("entryDeadline", e.target.value)} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Dates, discipline, and status are managed from the competition page (status control + classes).
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !form.name}>{saving ? "Saving…" : "Save changes"}</Button>
        <Button type="button" variant="outline" onClick={() => router.push(`/competitions/${competitionId}`)}>Cancel</Button>
      </div>
    </form>
  );
}
