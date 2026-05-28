"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Initial = {
  summary: string;
  horsesWorked: number | null;
  ridersTaught: number | null;
  injuriesNoted: string | null;
  minutesSpent: number | null;
};

export function DailyUpdateForm({ date, initial }: { date: string; initial: Initial | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    summary: initial?.summary ?? "",
    horsesWorked: initial?.horsesWorked != null ? String(initial.horsesWorked) : "",
    ridersTaught: initial?.ridersTaught != null ? String(initial.ridersTaught) : "",
    injuriesNoted: initial?.injuriesNoted ?? "",
    minutesSpent: initial?.minutesSpent != null ? String(initial.minutesSpent) : "",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (form.summary.trim().length < 3) {
      toast.error("Add a short summary of the day.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/coach-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          summary: form.summary.trim(),
          horsesWorked: form.horsesWorked ? Number(form.horsesWorked) : undefined,
          ridersTaught: form.ridersTaught ? Number(form.ridersTaught) : undefined,
          injuriesNoted: form.injuriesNoted.trim() || undefined,
          minutesSpent: form.minutesSpent ? Number(form.minutesSpent) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Saved today's update");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>What did you cover today?</Label>
        <Textarea
          rows={3}
          value={form.summary}
          onChange={(e) => set("summary", e.target.value)}
          maxLength={2000}
          placeholder="Flatwork with the L2 batch, lunged the two greenies, schooled poles in the evening session…"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Horses worked</Label>
          <Input type="number" value={form.horsesWorked} onChange={(e) => set("horsesWorked", e.target.value)} placeholder="6" />
        </div>
        <div>
          <Label>Riders taught</Label>
          <Input type="number" value={form.ridersTaught} onChange={(e) => set("ridersTaught", e.target.value)} placeholder="12" />
        </div>
        <div>
          <Label>Minutes on the yard</Label>
          <Input type="number" value={form.minutesSpent} onChange={(e) => set("minutesSpent", e.target.value)} placeholder="240" />
        </div>
      </div>
      <div>
        <Label>Injuries / concerns to flag (optional)</Label>
        <Textarea
          rows={2}
          value={form.injuriesNoted}
          onChange={(e) => set("injuriesNoted", e.target.value)}
          maxLength={1000}
          placeholder="Raja pulled up slightly off behind — asked stable manager to monitor. Full injury logged in /injuries."
        />
      </div>
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save daily update"}
        </Button>
      </div>
    </div>
  );
}
