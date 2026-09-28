"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson } from "@/lib/client/post-json";

// Mirrors MAX_RIDERS_PER_SITTING in lib/exam-booking.ts (a server module).
const MAX_PER_GROUP = 200;

type RiderRow = {
  id: string;
  name: string;
  school: string;
  currentLevel: string | null;
  suggested: number | null;
  blocked: string | null;
};

export function NewExamDayForm({
  levels,
  examiners,
  riders,
}: {
  levels: { rank: number; name: string }[];
  examiners: { id: string; name: string }[];
  riders: RiderRow[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [time, setTime] = useState("08:00");
  const [notes, setNotes] = useState("");
  // riderId → level they sit (absent = not sitting)
  const [assign, setAssign] = useState<Map<string, number>>(new Map());
  const [pools, setPools] = useState<Record<number, Set<string>>>({});
  // Optional jury panel per level — co-judges on every rider. Never the same
  // person as the level's pool (the API refuses that).
  const [panels, setPanels] = useState<Record<number, Set<string>>>({});
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("");
  const [busy, setBusy] = useState(false);

  const bookable = riders.filter((r) => !r.blocked);
  const blocked = riders.filter((r) => r.blocked);
  const schools = useMemo(() => Array.from(new Set(bookable.map((r) => r.school).filter(Boolean))).sort(), [bookable]);
  const shown = bookable.filter(
    (r) => (!q || r.name.toLowerCase().includes(q.toLowerCase())) && (!school || r.school === school),
  );
  const levelName = (rank: number) => levels.find((l) => l.rank === rank)?.name ?? `Level ${rank}`;
  const fallback = levels[0]?.rank ?? 1;

  const setLevel = (id: string, level: number | null) =>
    setAssign((prev) => {
      const next = new Map(prev);
      if (level === null) next.delete(id);
      else next.set(id, level);
      return next;
    });
  const addShown = () =>
    setAssign((prev) => {
      const next = new Map(prev);
      for (const r of shown) if (!next.has(r.id)) next.set(r.id, r.suggested ?? fallback);
      return next;
    });
  const removeShown = () =>
    setAssign((prev) => {
      const next = new Map(prev);
      for (const r of shown) next.delete(r.id);
      return next;
    });
  const toggleIn = (
    setter: typeof setPools,
    other: typeof setPools,
    level: number,
    id: string,
  ) => {
    setter((prev) => {
      const set = new Set(prev[level] ?? []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, [level]: set };
    });
    other((prev) => {
      if (!prev[level]?.has(id)) return prev;
      const set = new Set(prev[level]);
      set.delete(id);
      return { ...prev, [level]: set };
    });
  };
  const togglePool = (level: number, id: string) => toggleIn(setPools, setPanels, level, id);
  const togglePanel = (level: number, id: string) => toggleIn(setPanels, setPools, level, id);
  // A level bigger than one sitting runs as near-equal groups (server:
  // splitIntoGroups), sharing the level's examiners and panel.
  const groupsFor = (count: number) => Math.ceil(count / MAX_PER_GROUP);

  const perLevel = levels
    .map((l) => ({ ...l, count: Array.from(assign.values()).filter((v) => v === l.rank).length }))
    .filter((l) => l.count > 0);
  const missingPool = perLevel.filter((l) => !(pools[l.rank]?.size ?? 0));
  const total = assign.size;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (total === 0) return toast.error("Add at least one rider.");
    if (missingPool.length) return toast.error(`Pick examiners for ${missingPool.map((l) => l.name).join(", ")}.`);
    setBusy(true);
    const body = {
      name: name.trim() || `Exam day ${date}`,
      date,
      time,
      notes: notes || undefined,
      entries: Array.from(assign.entries()).map(([riderId, level]) => ({ riderId, level })),
      pools: Object.fromEntries(perLevel.map((l) => [String(l.rank), Array.from(pools[l.rank] ?? [])])),
      panels: Object.fromEntries(
        perLevel.filter((l) => panels[l.rank]?.size).map((l) => [String(l.rank), Array.from(panels[l.rank]!)]),
      ),
    };
    let res = await postJson<{ id: string; examsCreated: number }>("/api/exam-days", body);
    if (!res.ok && res.code === "LEVEL_SKIP") {
      const ok = await openConfirm({
        title: "Book riders past their next level?",
        body: res.message,
        confirmLabel: "Book anyway",
      });
      if (!ok) {
        setBusy(false);
        return;
      }
      res = await postJson<{ id: string; examsCreated: number }>("/api/exam-days", { ...body, allowSkipLevels: true });
    }
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(`Exam day booked — ${res.data.examsCreated} riders across ${perLevel.length} level${perLevel.length === 1 ? "" : "s"}`);
    router.push(`/exams/days/${res.data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Exam day ${date}`} maxLength={120} />
        </div>
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <Label>Start time</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Label>Riders — {total} sitting</Label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={addShown} disabled={shown.length === 0}>
              Add all shown ({shown.length}) at their next level
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={removeShown} disabled={shown.length === 0}>
              Remove shown
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search riders…" />
          {schools.length > 0 && (
            <Select aria-label="School" value={school} onChange={(e) => setSchool(e.target.value)} className="max-w-full sm:max-w-[16rem]">
              <option value="">All schools</option>
              {schools.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="max-h-[28rem] overflow-y-auto rounded-md border bg-card">
          {shown.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">No riders match.</div>}
          {shown.map((r) => {
            const level = assign.get(r.id);
            const skips = level !== undefined && r.suggested !== null && level > r.suggested;
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-sm last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.currentLevel ?? "No level yet"}
                    {r.school ? ` · ${r.school}` : ""}
                  </div>
                </div>
                {skips && <Badge variant="warning">skips a level</Badge>}
                <Select
                  aria-label={`Level for ${r.name}`}
                  value={level === undefined ? "" : String(level)}
                  onChange={(e) => setLevel(r.id, e.target.value ? Number(e.target.value) : null)}
                  className="w-40"
                >
                  <option value="">— not sitting —</option>
                  {levels.map((l) => (
                    <option key={l.rank} value={l.rank}>
                      {l.name}
                      {r.suggested === l.rank ? " (next)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
            );
          })}
        </div>
        {blocked.length > 0 && (
          <details className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              {blocked.length} rider{blocked.length === 1 ? " can't" : "s can't"} be booked yet
            </summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
              {blocked.map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.name}</span> — {r.blocked}
                </li>
              ))}
            </ul>
            <Link href="/riders/consent" className="mt-2 inline-block text-xs text-primary underline">
              Chase missing consent →
            </Link>
          </details>
        )}
      </div>

      <div className="space-y-3">
        <Label>Levels on the day and their examiners</Label>
        {perLevel.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add riders to see the levels on the day.</p>
        ) : (
          perLevel.map((l) => (
            <div key={l.rank} className="rounded-md border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{levelName(l.rank)}</span>
                <span className="text-xs text-muted-foreground">
                  {l.count} rider{l.count === 1 ? "" : "s"} · {pools[l.rank]?.size ?? 0} examiner
                  {(pools[l.rank]?.size ?? 0) === 1 ? "" : "s"}
                  {(panels[l.rank]?.size ?? 0) > 0 && ` · ${panels[l.rank]!.size} on the panel`}
                </span>
              </div>
              {groupsFor(l.count) > 1 && (
                <p className="mb-2 text-xs">
                  Runs as {groupsFor(l.count)} groups of about {Math.ceil(l.count / groupsFor(l.count))} riders (the most in
                  one group is {MAX_PER_GROUP}). The examiners below work every group.
                </p>
              )}
              {examiners.length === 0 ? (
                <p className="text-xs text-muted-foreground">This centre has no active examiners.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {examiners.map((u) => (
                    <label
                      key={u.id}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-muted/40"
                    >
                      <input type="checkbox" checked={pools[l.rank]?.has(u.id) ?? false} onChange={() => togglePool(l.rank, u.id)} />
                      {u.name}
                    </label>
                  ))}
                </div>
              )}
              {examiners.length > 1 && (
                <details className="mt-2" open={(panels[l.rank]?.size ?? 0) > 0}>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Jury panel (optional) — judges who co-judge every rider at this level
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {examiners.map((u) => (
                      <label
                        key={u.id}
                        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-sm hover:bg-muted/40"
                      >
                        <input
                          type="checkbox"
                          aria-label={`${u.name} on the Level ${l.rank} panel`}
                          checked={panels[l.rank]?.has(u.id) ?? false}
                          onChange={() => togglePanel(l.rank, u.id)}
                        />
                        {u.name}
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))
        )}
      </div>

      <div>
        <Label>Notes (optional)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
      </div>

      <Button type="submit" disabled={busy || total === 0 || missingPool.length > 0}>
        {busy ? "Booking…" : `Book exam day — ${total} rider${total === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
