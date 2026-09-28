"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { postJson } from "@/lib/client/post-json";
import { UserPlus } from "lucide-react";

export type LateRider = { id: string; name: string; school: string; currentLevel: string | null; suggested: number | null };

const SHOW = 60;

// Add riders to a sitting or an exam day that's already booked. In a sitting
// every rider sits its level; on a day each rider is given a level, and a
// level not on the day yet needs its examiners picked.
export function AddLateRiders(
  props: {
    riders: LateRider[];
  } & (
    | { mode: "sitting"; sittingId: string; level: number; levelName: string }
    | {
        mode: "day";
        dayId: string;
        levels: { rank: number; name: string }[];
        levelsOnDay: number[];
        examiners: { id: string; name: string }[];
      }
  ),
) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("");
  // riderId → level
  const [pick, setPick] = useState<Map<string, number>>(new Map());
  const [pools, setPools] = useState<Record<number, Set<string>>>({});
  const [busy, setBusy] = useState(false);

  const schools = useMemo(() => Array.from(new Set(props.riders.map((r) => r.school).filter(Boolean))).sort(), [props.riders]);
  const needle = q.trim().toLowerCase();
  const matches = props.riders.filter(
    (r) => (!needle || r.name.toLowerCase().includes(needle)) && (!school || r.school === school),
  );
  const shown = matches.slice(0, SHOW);
  const levelsFor = props.mode === "day" ? props.levels : [{ rank: props.level, name: props.levelName }];
  const defaultLevel = (r: LateRider) =>
    props.mode === "sitting" ? props.level : (r.suggested ?? props.levels[0]?.rank ?? 1);
  const newLevels =
    props.mode === "day"
      ? Array.from(new Set(pick.values())).filter((l) => !props.levelsOnDay.includes(l)).sort((a, b) => a - b)
      : [];
  const missingPool = newLevels.filter((l) => !(pools[l]?.size ?? 0));

  const set = (id: string, level: number | null) =>
    setPick((prev) => {
      const next = new Map(prev);
      if (level === null) next.delete(id);
      else next.set(id, level);
      return next;
    });

  async function submit() {
    if (pick.size === 0) return;
    if (missingPool.length) return toast.error(`Pick examiners for Level ${missingPool.join(", ")}.`);
    setBusy(true);
    const url = props.mode === "sitting" ? `/api/exam-sittings/${props.sittingId}/riders` : `/api/exam-days/${props.dayId}/riders`;
    const body =
      props.mode === "sitting"
        ? { riderIds: Array.from(pick.keys()) }
        : {
            entries: Array.from(pick.entries()).map(([riderId, level]) => ({ riderId, level })),
            pools: Object.fromEntries(newLevels.map((l) => [String(l), Array.from(pools[l] ?? [])])),
          };
    let res = await postJson<{ added: number }>(url, body);
    if (!res.ok && res.code === "LEVEL_SKIP") {
      const ok = await openConfirm({ title: "Book riders past their next level?", body: res.message, confirmLabel: "Book anyway" });
      if (!ok) {
        setBusy(false);
        return;
      }
      res = await postJson<{ added: number }>(url, { ...body, allowSkipLevels: true });
    }
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(`${res.data.added} rider${res.data.added === 1 ? "" : "s"} added`);
    setPick(new Map());
    setPools({});
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> Add late riders
      </Button>
    );
  }
  return (
    <div className="w-full space-y-3 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          Add late riders{props.mode === "sitting" ? ` to ${props.levelName}` : " to this day"}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      {props.riders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every enrolled rider is already booked here.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search riders…" aria-label="Search riders to add" />
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
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border">
            {shown.length === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">No riders match.</div>}
            {shown.map((r) => {
              const level = pick.get(r.id);
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
                  {props.mode === "sitting" ? (
                    <input
                      type="checkbox"
                      aria-label={`Add ${r.name}`}
                      checked={level !== undefined}
                      onChange={(e) => set(r.id, e.target.checked ? defaultLevel(r) : null)}
                    />
                  ) : (
                    <Select
                      aria-label={`Level for ${r.name}`}
                      value={level === undefined ? "" : String(level)}
                      onChange={(e) => set(r.id, e.target.value ? Number(e.target.value) : null)}
                      className="w-40"
                    >
                      <option value="">— not adding —</option>
                      {levelsFor.map((l) => (
                        <option key={l.rank} value={l.rank}>
                          {l.name}
                          {r.suggested === l.rank ? " (next)" : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
          {matches.length > SHOW && (
            <p className="text-xs text-muted-foreground">
              Showing {SHOW} of {matches.length} — search to find someone else.
            </p>
          )}
          {props.mode === "day" &&
            newLevels.map((l) => (
              <div key={l} className="rounded-md border p-2">
                <div className="mb-1 text-xs font-medium">
                  {levelsFor.find((x) => x.rank === l)?.name ?? `Level ${l}`} isn&rsquo;t on this day yet — pick its examiners
                </div>
                <div className="flex flex-wrap gap-2">
                  {props.examiners.map((u) => (
                    <label key={u.id} className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={pools[l]?.has(u.id) ?? false}
                        onChange={() =>
                          setPools((prev) => {
                            const s = new Set(prev[l] ?? []);
                            if (s.has(u.id)) s.delete(u.id);
                            else s.add(u.id);
                            return { ...prev, [l]: s };
                          })
                        }
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          <Button type="button" size="sm" onClick={submit} disabled={busy || pick.size === 0 || missingPool.length > 0}>
            {busy ? "Adding…" : `Add ${pick.size} rider${pick.size === 1 ? "" : "s"}`}
          </Button>
        </>
      )}
    </div>
  );
}
