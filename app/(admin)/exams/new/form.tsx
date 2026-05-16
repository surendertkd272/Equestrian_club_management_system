"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type CatalogLevel = { id: string; discipline: string; code: string; name: string; orderIndex: number };

export function NewExamForm({
  riders,
  examiners,
  templates,
  catalog,
  preselectRiderId,
}: {
  riders: { id: string; firstName: string; lastName: string; currentLevel: string | null }[];
  examiners: { id: string; name: string; role: string }[];
  templates: { levelKey: string; levelName: string }[];
  catalog: CatalogLevel[];
  preselectRiderId?: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  // Honour the ?riderId=… deep link from the rider detail page; otherwise
  // default to the first rider in the picker.
  const initialRiderId =
    preselectRiderId && riders.some((r) => r.id === preselectRiderId)
      ? preselectRiderId
      : riders[0]?.id ?? "";
  const [form, setForm] = useState({
    riderId: initialRiderId,
    examinerId: examiners[0]?.id ?? "",
    level: templates[0]?.levelKey ?? "1",
    date: today,
    time: "09:00",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? err.error ?? "Failed");
      return;
    }
    const data = await res.json();
    toast.success("Exam scheduled");
    router.push(`/exams/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Rider *</Label>
        <Select value={form.riderId} onChange={(e) => set("riderId", e.target.value)}>
          {riders.map((r) => (
            <option key={r.id} value={r.id}>
              {r.firstName} {r.lastName}
              {r.currentLevel ? ` · current: ${r.currentLevel}` : ""}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Examiner *</Label>
        <Select value={form.examinerId} onChange={(e) => set("examinerId", e.target.value)}>
          {examiners.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.role.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Level *</Label>
        <Select value={form.level} onChange={(e) => set("level", e.target.value)}>
          {/*
            Prefer the HQ catalog when available: shows the full
            discipline → level label so the dropdown stops looking like
            "L1 L2 L1 L2". Falls back to per-centre templates if the
            catalog is empty (e.g. immediately after first deploy).
          */}
          {catalog.length > 0
            ? catalog.map((c) => (
                <option key={c.id} value={String(c.orderIndex)}>
                  {c.discipline === "general" ? "" : `${c.discipline} · `}
                  {c.code} — {c.name}
                </option>
              ))
            : templates.map((t) => (
                <option key={t.levelKey} value={t.levelKey}>
                  {t.levelName}
                </option>
              ))}
        </Select>
        {catalog.length === 0 && templates.length === 0 && (
          <p className="text-xs text-amber-700">
            No levels in the catalog. Ask a Super Admin to set them up in{" "}
            <a href="/exams/levels" className="underline">Level catalog</a>.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Date *</Label>
          <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Time *</Label>
          <Input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} required />
        </div>
      </div>
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Scheduling…" : "Schedule exam"}
      </Button>
    </form>
  );
}
