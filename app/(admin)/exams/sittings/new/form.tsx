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
  const [coExaminers, setCoExaminers] = useState<Set<string>>(new Set());
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
  function toggleCo(id: string) {
    setCoExaminers((prev) => {
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
          examinerIds: [examinerId, ...Array.from(coExaminers)],
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
          <Label>Lead examiner</Label>
          <Select
            value={examinerId}
            onChange={(e) => {
              const id = e.target.value;
              setExaminerId(id);
              setCoExaminers((p) => {
                const n = new Set(p);
                n.delete(id);
                return n;
              });
            }}
          >
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
        <Label>Co-examiners (panel) — optional</Label>
        <p className="text-[11px] text-muted-foreground">
          Everyone added here judges every rider alongside the lead; each rider&apos;s score averages the panel&apos;s cards.
        </p>
        <div className="flex flex-wrap gap-2">
          {examiners.filter((u) => u.id !== examinerId).length === 0 ? (
            <span className="text-sm text-muted-foreground">No other examiners available.</span>
          ) : (
            examiners
              .filter((u) => u.id !== examinerId)
              .map((u) => (
                <label
                  key={u.id}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-sm hover:bg-muted/40"
                >
                  <input type="checkbox" checked={coExaminers.has(u.id)} onChange={() => toggleCo(u.id)} />
                  <span>{u.name}</span>
                </label>
              ))
          )}
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
