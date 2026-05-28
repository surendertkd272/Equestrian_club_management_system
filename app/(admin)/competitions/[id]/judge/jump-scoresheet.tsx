"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

type Effort = {
  fenceNo: string;
  knockdown: boolean;
  refusal: number;
  eliminated: boolean;
  fall: boolean;
  notes: string;
};

// FEI Table A scoresheet. The judge enters per-fence efforts; the server
// computes faults + handles eliminations. Local total preview is informational
// only — the canonical number comes back from the POST response.
function localFaults(efforts: Effort[], timeSec: number | null, timeAllowedSec: number | null) {
  let elim = false;
  let reason = "";
  for (const e of efforts) {
    if (e.fall) { elim = true; reason = `Fall at ${e.fenceNo}`; break; }
    if (e.eliminated || e.refusal >= 3) { elim = true; reason = `Eliminated at ${e.fenceNo}`; break; }
  }
  if (elim) return { faults: null as number | null, eliminated: true, reason };
  let total = 0;
  for (const e of efforts) {
    if (e.knockdown) total += 4;
    total += Math.min(e.refusal, 2) * 4;
  }
  if (timeSec !== null && timeAllowedSec !== null && timeSec > timeAllowedSec) {
    total += Math.ceil((timeSec - timeAllowedSec) / 4);
  }
  return { faults: total, eliminated: false, reason: "" };
}

export function JumpScoresheet({
  competitionId,
  roundId,
  entryId,
  entryLabel,
  initialTimeAllowed,
  initialTimeLimit,
}: {
  competitionId: string;
  roundId: string;
  entryId: string;
  entryLabel: string;
  initialTimeAllowed: number | null;
  initialTimeLimit: number | null;
}) {
  const [efforts, setEfforts] = useState<Effort[]>([
    { fenceNo: "1", knockdown: false, refusal: 0, eliminated: false, fall: false, notes: "" },
  ]);
  const [timeSec, setTimeSec] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [serverResult, setServerResult] = useState<{ faults: number | null; eliminated: boolean; reason: string | null } | null>(null);

  // Hydrate existing scoresheet.
  useEffect(() => {
    fetch(`/api/competitions/${competitionId}/jump-scores?roundId=${roundId}&entryId=${entryId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.efforts) && data.efforts.length > 0) {
          setEfforts(data.efforts.map((e: any) => ({
            fenceNo: e.fenceNo,
            knockdown: e.knockdown,
            refusal: e.refusal,
            eliminated: e.eliminated,
            fall: e.fall,
            notes: e.notes ?? "",
          })));
        }
        if (data.aggregate?.time !== null && data.aggregate?.time !== undefined) {
          setTimeSec(String(data.aggregate.time));
        }
      })
      .catch(() => {});
  }, [competitionId, roundId, entryId]);

  const totalPreview = localFaults(efforts, timeSec ? Number(timeSec) : null, initialTimeAllowed);

  function setRow(i: number, patch: Partial<Effort>) {
    setEfforts((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    const nextNo = String(efforts.length + 1);
    setEfforts((rows) => [...rows, { fenceNo: nextNo, knockdown: false, refusal: 0, eliminated: false, fall: false, notes: "" }]);
  }
  function removeRow(i: number) {
    setEfforts((rows) => rows.length === 1 ? rows : rows.filter((_, idx) => idx !== i));
  }

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/competitions/${competitionId}/jump-scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roundId,
        entryId,
        efforts: efforts.map((e) => ({
          fenceNo: e.fenceNo,
          knockdown: e.knockdown,
          refusal: Number(e.refusal),
          eliminated: e.eliminated,
          fall: e.fall,
          notes: e.notes || null,
        })),
        timeSec: timeSec ? Number(timeSec) : null,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.message ?? data.error ?? "Failed");
      return;
    }
    setServerResult({ faults: data.faults, eliminated: data.eliminated, reason: data.reason });
    toast.success(data.eliminated ? `ELIMINATED · ${data.reason}` : `Saved · ${data.faults} fault${data.faults === 1 ? "" : "s"}`);
  }

  const final = serverResult ?? totalPreview;

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Jump scoresheet · {entryLabel}</h3>
          <p className="text-xs text-muted-foreground">
            Time allowed: {initialTimeAllowed ?? "—"}s · Time limit: {initialTimeLimit ?? "—"}s
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {serverResult ? "Recorded" : "Preview"}
          </div>
          {final.eliminated ? (
            <Badge variant="destructive" className="text-sm">ELIMINATED</Badge>
          ) : (
            <div className="text-2xl font-bold">{final.faults ?? 0} <span className="text-xs font-normal text-muted-foreground">faults</span></div>
          )}
          {final.eliminated && final.reason && <div className="text-[10px] text-muted-foreground">{final.reason}</div>}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="pb-1">Fence</th>
            <th className="pb-1 text-center">Knockdown</th>
            <th className="pb-1 text-center">Refusals</th>
            <th className="pb-1 text-center">Elim</th>
            <th className="pb-1 text-center">Fall</th>
            <th className="pb-1">Notes</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y">
          {efforts.map((e, i) => (
            <tr key={i}>
              <td className="py-1 pr-2 w-20">
                <Input value={e.fenceNo} onChange={(ev) => setRow(i, { fenceNo: ev.target.value })} className="h-8" />
              </td>
              <td className="py-1 text-center">
                <input type="checkbox" checked={e.knockdown} onChange={(ev) => setRow(i, { knockdown: ev.target.checked })} />
              </td>
              <td className="py-1 text-center w-20">
                <Input
                  type="number"
                  min={0}
                  max={3}
                  value={e.refusal}
                  onChange={(ev) => setRow(i, { refusal: Number(ev.target.value) })}
                  className="h-8 text-center"
                />
              </td>
              <td className="py-1 text-center">
                <input type="checkbox" checked={e.eliminated} onChange={(ev) => setRow(i, { eliminated: ev.target.checked })} />
              </td>
              <td className="py-1 text-center">
                <input type="checkbox" checked={e.fall} onChange={(ev) => setRow(i, { fall: ev.target.checked })} />
              </td>
              <td className="py-1 pr-2">
                <Input value={e.notes} onChange={(ev) => setRow(i, { notes: ev.target.value })} className="h-8" />
              </td>
              <td className="py-1">
                <Button variant="ghost" size="sm" onClick={() => removeRow(i)}><Trash2 className="h-4 w-4" /></Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <Button variant="outline" size="sm" onClick={addRow}><Plus className="mr-1 h-3 w-3" /> Add fence</Button>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Time (seconds)</Label>
            <Input
              type="number"
              step="0.01"
              value={timeSec}
              onChange={(e) => setTimeSec(e.target.value)}
              className="h-9 w-32"
            />
          </div>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save scoresheet"}</Button>
        </div>
      </div>
    </div>
  );
}
