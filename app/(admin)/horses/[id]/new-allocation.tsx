"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { postJson } from "@/lib/client/post-json";

export function NewAllocationForm({
  horseId,
  riders,
}: {
  horseId: string;
  riders: { id: string; firstName: string; lastName: string }[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const todayLocal = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    riderId: "",
    purpose: "lesson",
    date: todayLocal,
    startTime: "07:00",
    endTime: "08:00",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const startAt = `${form.date}T${form.startTime}`;
    const endAt = `${form.date}T${form.endTime}`;
    const res = await postJson(`/api/horses/${horseId}/allocations`, {
      riderId: form.riderId || null,
      purpose: form.purpose,
      startAt,
      endAt,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Allocation added");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-5 md:items-end">
      <div className="space-y-1.5">
        <Label>Purpose</Label>
        <Select aria-label="Purpose" value={form.purpose} onChange={(e) => set("purpose", e.target.value)}>
          <option value="lesson">Lesson</option>
          <option value="exam">Exam</option>
          <option value="competition">Competition</option>
          <option value="training">Training</option>
          <option value="exercise">Exercise</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Rider</Label>
        <Select aria-label="Rider" value={form.riderId} onChange={(e) => set("riderId", e.target.value)}>
          <option value="">(none)</option>
          {riders.map((r) => (
            <option key={r.id} value={r.id}>
              {r.firstName} {r.lastName}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Date</Label>
        <Input aria-label="Date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>Start</Label>
        <Input aria-label="Start" type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>End</Label>
        <Input aria-label="End" type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} required />
      </div>
      <div className="md:col-span-5">
        <Button type="submit" disabled={saving} className="w-full md:w-auto">
          {saving ? "Saving…" : "Allocate"}
        </Button>
      </div>
    </form>
  );
}
