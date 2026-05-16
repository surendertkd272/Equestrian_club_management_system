"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TEMPLATES = [
  { label: "Muck out stalls", desc: "Clean all stalls and refresh bedding.", time: "06:00", rec: "daily" },
  { label: "Morning feed", desc: "Feed all horses per dietary chart.", time: "06:30", rec: "daily" },
  { label: "Evening feed", desc: "Feed all horses per dietary chart.", time: "18:00", rec: "daily" },
  { label: "Tack inspection", desc: "Check girths/stitching/stirrups across all saddles.", time: "10:00", rec: "weekly" },
  { label: "Farrier visit", desc: "Schedule trims/shoes for due horses.", time: "09:00", rec: "monthly" },
];

export function NewTaskForm({ users }: { users: { id: string; name: string; role: string }[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    title: "",
    description: "",
    assigneeId: "",
    date: today,
    time: "09:00",
    recurrence: "once",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    setForm((f) => ({ ...f, title: t.label, description: t.desc, time: t.time, recurrence: t.rec }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload: any = {
      title: form.title,
      description: form.description || undefined,
      assigneeId: form.assigneeId || null,
      recurrence: form.recurrence,
    };
    if (form.date && form.time) payload.dueAt = `${form.date}T${form.time}`;
    const res = await fetch("/api/tasks", {
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
    toast.success("Task created");
    router.push("/tasks");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-md border bg-muted/40 p-2">
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Quick templates</div>
        <div className="flex flex-wrap gap-1">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => applyTemplate(t)}
              className="rounded-md border bg-card px-2 py-1 text-xs hover:bg-background"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Title *</Label>
        <Input required value={form.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Assignee</Label>
          <Select value={form.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
            <option value="">(unassigned)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Recurrence</Label>
          <Select value={form.recurrence} onChange={(e) => set("recurrence", e.target.value)}>
            <option value="once">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Due date</Label>
          <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Due time</Label>
          <Input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
        </div>
      </div>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Creating…" : "Create task"}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Recurrence is a label for now — a per-day generator (cron) will be wired in a later sprint.
      </p>
    </form>
  );
}
