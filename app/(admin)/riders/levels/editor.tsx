"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { postJson } from "@/lib/client/post-json";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";

type Row = { id: string; name: string; school: string; schoolClass: string; level: string | null };

const NONE = "";
const SHOW = 200;

export function LevelsEditor({ levels, riders }: { levels: string[]; riders: Row[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("");
  const [onlyNone, setOnlyNone] = useState(false);
  // riderId → new level ("" = no level)
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [bulk, setBulk] = useState(levels[0] ?? "");
  const [busy, setBusy] = useState(false);

  const schools = useMemo(() => Array.from(new Set(riders.map((r) => r.school).filter(Boolean))).sort(), [riders]);
  const current = (r: Row) => edits.get(r.id) ?? r.level ?? NONE;
  const needle = q.trim().toLowerCase();
  const matches = riders.filter(
    (r) =>
      (!needle || r.name.toLowerCase().includes(needle) || r.schoolClass.toLowerCase() === needle) &&
      (!school || r.school === school) &&
      (!onlyNone || !r.level),
  );
  const shown = matches.slice(0, SHOW);
  const changed = riders.filter((r) => edits.has(r.id) && edits.get(r.id) !== (r.level ?? NONE));
  useUnsavedChanges(changed.length > 0 && !busy);

  const set = (id: string, level: string) =>
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(id, level);
      return next;
    });
  const setMatches = () =>
    setEdits((prev) => {
      const next = new Map(prev);
      for (const r of matches) next.set(r.id, bulk);
      return next;
    });

  async function save() {
    if (changed.length === 0) return;
    setBusy(true);
    const res = await postJson<{ updated: number }>("/api/riders/levels", {
      changes: changed.map((r) => ({ riderId: r.id, level: edits.get(r.id) || null })),
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(`${res.data.updated} rider${res.data.updated === 1 ? "" : "s"} updated`);
    setEdits(new Map());
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, or type a class (e.g. 7)…"
          aria-label="Search riders"
        />
        {schools.length > 0 && (
          <Select aria-label="School" value={school} onChange={(e) => setSchool(e.target.value)} className="max-w-full sm:max-w-[14rem]">
            <option value="">All schools</option>
            {schools.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyNone} onChange={(e) => setOnlyNone(e.target.checked)} />
          No level yet
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
        <span>Set all {matches.length} shown to</span>
        <Select aria-label="Level for all shown" value={bulk} onChange={(e) => setBulk(e.target.value)} className="w-44">
          {levels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
          <option value={NONE}>No level yet</option>
        </Select>
        <Button type="button" size="sm" variant="outline" onClick={setMatches} disabled={matches.length === 0}>
          Apply to shown
        </Button>
      </div>

      <div className="max-h-[32rem] overflow-y-auto rounded-md border bg-card">
        {shown.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">No riders match.</div>}
        {shown.map((r) => {
          const v = current(r);
          const dirty = edits.has(r.id) && v !== (r.level ?? NONE);
          return (
            <div key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-sm last:border-b-0 ${dirty ? "bg-warning-soft" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[r.school, r.schoolClass && `Class ${r.schoolClass}`].filter(Boolean).join(" · ") || "—"}
                  {dirty ? ` · was ${r.level ?? "no level"}` : ""}
                </div>
              </div>
              <Select aria-label={`Level for ${r.name}`} value={v} onChange={(e) => set(r.id, e.target.value)} className="w-44">
                <option value={NONE}>No level yet</option>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
                {r.level && !levels.includes(r.level) && <option value={r.level}>{r.level} (not on the ladder)</option>}
              </Select>
            </div>
          );
        })}
      </div>
      {matches.length > SHOW && (
        <p className="text-xs text-muted-foreground">
          Showing {SHOW} of {matches.length} — &ldquo;Apply to shown&rdquo; covers all {matches.length}.
        </p>
      )}

      <div className="sticky bottom-2 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
        <span className="text-sm">
          {changed.length} change{changed.length === 1 ? "" : "s"}
        </span>
        <Button onClick={save} disabled={busy || changed.length === 0}>
          {busy ? "Saving…" : "Save levels"}
        </Button>
        {changed.length > 0 && (
          <Button variant="ghost" onClick={() => setEdits(new Map())} disabled={busy}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}
