"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function NewSittingForm({
  riders,
  examiners,
  levels,
}: {
  riders: { id: string; label: string }[];
  examiners: { id: string; name: string; role: string }[];
  levels: { key: string; name: string }[];
}) {
  const router = useRouter();
  const [level, setLevel] = useState(levels[0]?.key ?? "1");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [examinerId, setExaminerId] = useState(examiners[0]?.id ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (picked.size === 0) {
      toast.error("Pick at least one rider.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/exam-sittings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: Number(level),
          date,
          time,
          examinerId,
          riderIds: Array.from(picked),
          notes: notes || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(`Sitting scheduled — ${data.examsCreated} exams created`);
      router.push("/exams");
    } finally {
      setBusy(false);
    }
  }

  const visible = q
    ? riders.filter((r) => r.label.toLowerCase().includes(q.toLowerCase()))
    : riders;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Level</Label>
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            {levels.map((l) => (
              <option key={l.key} value={l.key}>
                {l.key} · {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Examiner</Label>
          <Select value={examinerId} onChange={(e) => setExaminerId(e.target.value)}>
            {examiners.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <Label>Time</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Riders ({picked.size} selected)</Label>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" />
        <div className="max-h-72 overflow-y-auto rounded-md border bg-card">
          {visible.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">No riders found.</div>
          )}
          {visible.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0 hover:bg-muted/40"
            >
              <input
                type="checkbox"
                checked={picked.has(r.id)}
                onChange={() => toggle(r.id)}
              />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label>Notes (optional)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      <Button type="submit" disabled={busy || picked.size === 0}>
        {busy ? "Scheduling…" : `Schedule ${picked.size} exam${picked.size === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
