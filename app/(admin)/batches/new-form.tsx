"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postJson } from "@/lib/client/post-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

// Canonical week order — the CSV is always emitted in this order no matter
// which sequence the days were ticked in, so "Tue,Wed,Thu" and "Thu,Tue,Wed"
// produce identical stored values.
const DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

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
    // Send centreId in the body so HQ admins (no session.centreId)
    // still POST against the centre they've picked via the topbar.
    const res = await postJson("/api/batches", { ...form, centreId });
    setSaving(false);
    if (!res.ok) {
      toast.error(
        (res.data as { details?: unknown })?.details ? "Check the fields — invalid format." : res.message,
      );
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
        <Label>Days</Label>
        {/* Day-of-week toggles replace the old free-text CSV field (typo-prone,
            custom combos weren't discoverable). Still stores the same
            "Mon,Wed,Fri" CSV so the API + lesson generation are unchanged. */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
          {DAY_OPTIONS.map((day) => {
            const selected = form.dayOfWeek.split(",").map((s) => s.trim()).includes(day);
            return (
              <button
                key={day}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => {
                  const days = form.dayOfWeek.split(",").map((s) => s.trim()).filter(Boolean);
                  const next = selected ? days.filter((d) => d !== day) : [...days, day];
                  set("dayOfWeek", DAY_OPTIONS.filter((d) => next.includes(d)).join(","));
                }}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
        {form.dayOfWeek === "" && (
          <p className="text-xs text-rose-600">Pick at least one day.</p>
        )}
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
      <Button type="submit" disabled={saving || disabled || form.dayOfWeek === ""} className="w-full">
        {saving ? "Creating…" : "Create Batch"}
      </Button>
    </form>
  );
}
