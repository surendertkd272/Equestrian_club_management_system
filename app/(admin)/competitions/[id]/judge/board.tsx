"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getDisciplineRules } from "@/lib/discipline";

type Entry = {
  id: string;
  riderName: string;
  className: string;
  score: number | null;
  faults: number | null;
  time: number | null;
  placement: number | null;
  team: string | null;
  status: string;
};

type Round = { id: string; className: string; roundNumber: number; name: string };

export function JudgeBoard({
  competitionId,
  discipline,
  classes,
  rounds,
  startList,
  entries,
}: {
  competitionId: string;
  discipline: string;
  classes: string[];
  rounds: Round[];
  startList: { entryId: string; className: string; order: number }[];
  entries: Entry[];
}) {
  const router = useRouter();
  const rules = getDisciplineRules(discipline);
  const [activeClass, setActiveClass] = useState(classes[0] ?? "");
  const classRounds = useMemo(() => rounds.filter((r) => r.className === activeClass), [rounds, activeClass]);
  const [activeRound, setActiveRound] = useState<string>("aggregate");

  // Build the row list — start-list order if available, else entry order.
  const order = startList
    .filter((s) => s.className === activeClass)
    .sort((a, b) => a.order - b.order);
  const orderMap = new Map(order.map((s) => [s.entryId, s.order]));
  const rows = entries
    .filter((e) => e.className === activeClass && e.status !== "withdrawn")
    .sort((a, b) => {
      const ao = orderMap.get(a.id);
      const bo = orderMap.get(b.id);
      if (ao !== undefined && bo !== undefined) return ao - bo;
      if (ao !== undefined) return -1;
      if (bo !== undefined) return 1;
      return a.riderName.localeCompare(b.riderName);
    });

  // Inline editor — only the discipline's primary channels are exposed.
  async function patch(entryId: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/competitions/${competitionId}/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("Save failed");
      return;
    }
    router.refresh();
  }

  // Per-discipline column layout — show only the channels that matter.
  const showScore = discipline === "dressage" || discipline === "generic" || discipline === "eventing";
  const showFaults = discipline === "jumping" || discipline === "eventing" || discipline === "gymkhana";
  const showTime = discipline === "jumping" || discipline === "eventing" || discipline === "gymkhana";

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Class</span>
          <select
            value={activeClass}
            onChange={(e) => setActiveClass(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-base"
          >
            {classes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">Round</span>
          <select
            value={activeRound}
            onChange={(e) => setActiveRound(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-base"
          >
            <option value="aggregate">Aggregate (final)</option>
            {classRounds.map((r) => (
              <option key={r.id} value={r.id}>
                Round {r.roundNumber} · {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="text-xs text-slate-400">
        Discipline: <strong>{rules.label}</strong> · ranking by {rules.primaryColumn}
      </div>

      <ul className="space-y-2">
        {rows.length === 0 && (
          <li className="rounded-md border border-slate-800 bg-slate-900 p-4 text-center text-sm text-slate-400">
            No entries in this class.
          </li>
        )}
        {rows.map((e) => (
          <li key={e.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-500">
                  #{orderMap.get(e.id) ?? "—"}
                </span>
                <div>
                  <div className="text-base font-semibold">{e.riderName}</div>
                  {e.team && <div className="text-[11px] text-slate-400">{e.team}</div>}
                </div>
              </div>
              {e.placement && (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
                  #{e.placement}
                </span>
              )}
            </div>

            <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${(showScore ? 1 : 0) + (showFaults ? 1 : 0) + (showTime ? 1 : 0) + 1}, minmax(0, 1fr))` }}>
              {showScore && (
                <label className="block">
                  <span className="text-[10px] uppercase text-slate-500">{discipline === "dressage" ? "%" : "Score"}</span>
                  <input
                    type="number"
                    step="0.1"
                    defaultValue={e.score ?? ""}
                    onBlur={(ev) => {
                      const v = ev.target.value === "" ? null : Number(ev.target.value);
                      if (v === e.score) return;
                      patch(e.id, { score: v });
                    }}
                    className="mt-1 h-12 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-lg font-mono text-slate-100"
                  />
                </label>
              )}
              {showFaults && (
                <label className="block">
                  <span className="text-[10px] uppercase text-slate-500">Faults</span>
                  <input
                    type="number"
                    step="0.1"
                    defaultValue={e.faults ?? ""}
                    onBlur={(ev) => {
                      const v = ev.target.value === "" ? null : Number(ev.target.value);
                      if (v === e.faults) return;
                      patch(e.id, { faults: v });
                    }}
                    className="mt-1 h-12 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-lg font-mono text-slate-100"
                  />
                </label>
              )}
              {showTime && (
                <label className="block">
                  <span className="text-[10px] uppercase text-slate-500">Time (s)</span>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={e.time ?? ""}
                    onBlur={(ev) => {
                      const v = ev.target.value === "" ? null : Number(ev.target.value);
                      if (v === e.time) return;
                      patch(e.id, { time: v });
                    }}
                    className="mt-1 h-12 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-lg font-mono text-slate-100"
                  />
                </label>
              )}
              <label className="block">
                <span className="text-[10px] uppercase text-slate-500">Place</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={e.placement ?? ""}
                  onBlur={(ev) => {
                    const v = ev.target.value === "" ? null : Number(ev.target.value);
                    if (v === e.placement) return;
                    patch(e.id, { placement: v });
                  }}
                  className="mt-1 h-12 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-lg font-mono text-slate-100"
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
