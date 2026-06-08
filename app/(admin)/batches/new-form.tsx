"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function NewBatchForm({
  coaches,
  disabled,
  centreId,
}: {
  coaches: { id: string; name: string }[];
  disabled?: boolean;
  // The centre the form is acting on. For centre-scoped users, this is
  // session.centreId. For HQ admins, it's the centre they picked via the
  // topbar filter (scopeCentre cookie). Sent in the POST body so the API
  // doesn't try to fall back on session.centreId (which is null for HQ).
  centreId: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    dayOfWeek: "Mon,Wed,Fri",
    startTime: "06:00",
    endTime: "07:00",
    level: "Beginner",
    coachId: coaches[0]?.id ?? "",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Send centreId in the body so HQ admins (no session.centreId)
      // still POST against the centre they've picked via the topbar.
      body: JSON.stringify({ ...form, centreId }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.details ? "Check the fields — invalid format." : err.error ?? "Failed");
      return;
    }
    toast.success("Batch created");
    setForm((f) => ({ ...f, name: "" }));
    router.refresh();
  }

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input aria-label="Name"
          required
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Saturday Pony Club"
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Days (CSV)</Label>
        <Input aria-label="Days (CSV)"
          required
          value={form.dayOfWeek}
          onChange={(e) => set("dayOfWeek", e.target.value)}
          placeholder="Mon,Wed,Fri"
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Start</Label>
          <Input aria-label="Start"
            required
            type="time"
            value={form.startTime}
            onChange={(e) => set("startTime", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label>End</Label>
          <Input aria-label="End"
            required
            type="time"
            value={form.endTime}
            onChange={(e) => set("endTime", e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Level</Label>
        <Select aria-label="Level" value={form.level} onChange={(e) => set("level", e.target.value)} disabled={disabled}>
          <option>Beginner</option>
          <option>Intermediate</option>
          <option>Advanced</option>
          <option>Pro</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Coach</Label>
        <Select aria-label="Coach" value={form.coachId} onChange={(e) => set("coachId", e.target.value)} disabled={disabled}>
          <option value="">(none)</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={saving || disabled} className="w-full">
        {saving ? "Creating…" : "Create batch"}
      </Button>
    </form>
  );
}
