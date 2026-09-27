"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { roleLabel } from "@/lib/labels";
import { openConfirm } from "@/components/ui/confirm-dialog";
import Link from "next/link";
export function NewSittingForm({
  riders,
  examiners,
  levels,
}: {
  riders: { id: string; label: string; blocked: string | null }[];
  examiners: { id: string; name: string; role: string }[];
  levels: { key: string; name: string }[];
}) {
  const router = useRouter();
  const [level, setLevel] = useState(levels[0]?.key ?? "1");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [pool, setPool] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pool.size === 0) {
      toast.error("Pick at least one examiner for the pool.");
      return;
    }
    if (picked.size === 0) {
      toast.error("Pick at least one rider.");
      return;
    }
    setBusy(true);
    try {
      const send = (allowSkipLevels: boolean) =>
        fetch("/api/exam-sittings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            level: Number(level),
            date,
            time,
            examinerIds: Array.from(pool),
            riderIds: Array.from(picked),
            notes: notes || undefined,
            ...(allowSkipLevels ? { allowSkipLevels: true } : {}),
          }),
        });
      let res = await send(false);
      let data = await res.json().catch(() => ({}));
      // Booking riders past the next level up needs a deliberate yes.
      if (res.status === 409 && data.error === "LEVEL_SKIP") {
        const ok = await openConfirm({
          title: "Book riders past their next level?",
          body: data.message,
          confirmLabel: "Book anyway",
        });
        if (!ok) return;
        res = await send(true);
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(`Sitting scheduled — ${data.examsCreated} riders, ${pool.size} examiners`);
      router.push(`/exams/sittings/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  const bookable = riders.filter((r) => !r.blocked);
  const blocked = riders.filter((r) => r.blocked);
  const visible = q ? bookable.filter((r) => r.label.toLowerCase().includes(q.toLowerCase())) : bookable;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Level</Label>
          <Select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
            {levels.map((l) => (
              <option key={l.key} value={l.key}>
                {l.key} · {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Date</Label>
          <Input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <Label>Time</Label>
          <Input aria-label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Examiners ({pool.size} selected)</Label>
        <p className="text-[11px] text-muted-foreground">
          Any examiner here can pick a rider on the day and start marking — that rider then locks to them.
        </p>
        <div className="flex flex-wrap gap-2">
          {examiners.length === 0 ? (
            <span className="text-sm text-muted-foreground">No examiners available.</span>
          ) : (
            examiners.map((u) => (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-sm hover:bg-muted/40"
              >
                <input type="checkbox" checked={pool.has(u.id)} onChange={() => toggleSet(setPool, u.id)} />
                <span>
                  {u.name} <span className="text-[10px] text-muted-foreground">· {roleLabel(u.role)}</span>
                </span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Riders ({picked.size} selected)</Label>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" />
        <div className="max-h-72 overflow-y-auto rounded-md border bg-card">
          {visible.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">No riders found.</div>}
          {visible.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0 hover:bg-muted/40"
            >
              <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggleSet(setPicked, r.id)} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
        {blocked.length > 0 && (
          <details className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              {blocked.length} rider{blocked.length === 1 ? " can't" : "s can't"} be booked yet
            </summary>
            <ul className="mt-2 space-y-1 text-xs">
              {blocked.map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.label}</span> — {r.blocked}
                </li>
              ))}
            </ul>
            <Link href="/riders/consent" className="mt-2 inline-block text-xs text-primary underline">
              Chase missing consent →
            </Link>
          </details>
        )}
      </div>

      <div>
        <Label>Notes (optional)</Label>
        <Textarea aria-label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      <Button type="submit" disabled={busy || picked.size === 0 || pool.size === 0}>
        {busy ? "Scheduling…" : "Schedule exam"}
      </Button>
    </form>
  );
}
