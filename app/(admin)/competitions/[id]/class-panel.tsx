"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Plus, Trash2, Medal } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { getDisciplineRulesForClass, rankEntries, scoringEngineFor } from "@/lib/discipline";
import { disciplineLabel } from "@/lib/competition-disciplines";

type Entry = {
  id: string;
  riderId: string;
  riderName: string;
  status: string;
  paid: boolean;
  placement: number | null;
  score: number | null;
  faults: number | null;
  time: number | null;
  teamId: string | null;
  teamName: string | null;
  notes: string | null;
  horseId: string | null;
};

type Class = { name: string; discipline?: string; fee: number; ageGroup?: string; maxEntries?: number };

export function ClassPanel({
  competitionId,
  competitionStatus,
  discipline,
  cls,
  entries,
  riders,
  horses,
  teams,
  canManage,
}: {
  competitionId: string;
  competitionStatus: string;
  discipline: string;
  cls: Class;
  entries: Entry[];
  riders: { id: string; label: string }[];
  horses: { id: string; label: string }[];
  teams: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newRiderId, setNewRiderId] = useState(riders[0]?.id ?? "");
  const [newHorseId, setNewHorseId] = useState("");
  const [newTeamId, setNewTeamId] = useState("");
  const acceptingEntries = competitionStatus !== "completed" && competitionStatus !== "cancelled";
  // This event scores by its own discipline; the competition `discipline` prop
  // is the fallback for events with no discipline of their own.
  const engine = scoringEngineFor(cls.discipline, discipline);
  const rules = getDisciplineRulesForClass(cls.discipline, discipline);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    const res = await fetch(`/api/competitions/${competitionId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        riderId: newRiderId,
        className: cls.name,
        horseId: newHorseId || null,
        teamId: newTeamId || null,
      }),
    });
    setAdding(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Surface horse double-booking as a warning + confirm-override, not a
      // hard stop — the user might still want to enter knowing the conflict.
      if (err.error === "HORSE_DOUBLE_BOOKED") {
        const ok = await openConfirm({
          title: "Horse is already entered in another class",
          body: `${err.detail ?? ""}\n\nContinue anyway?`,
          confirmLabel: "Enter anyway",
        });
        if (!ok) return;
        await fetch(`/api/competitions/${competitionId}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            riderId: newRiderId,
            className: cls.name,
            horseId: newHorseId || null,
            teamId: newTeamId || null,
            allowDoubleBook: true,
          }),
        });
        toast.success("Entered (with override)");
        router.refresh();
        return;
      }
      toast.error(err.message ?? err.error ?? "Failed");
      return;
    }
    toast.success(`Entered · ${cls.fee > 0 ? `invoice raised (₹${cls.fee})` : "no fee"}`);
    router.refresh();
  }

  async function updateEntry(entryId: string, body: Record<string, any>, successMsg?: string) {
    const res = await fetch(`/api/competitions/${competitionId}/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? err.error ?? "Failed");
      return false;
    }
    if (successMsg) toast.success(successMsg);
    router.refresh();
    return true;
  }

  async function deleteEntry(entryId: string) {
    const ok = await openConfirm({ title: "Remove this entry?", destructive: true, confirmLabel: "Remove" });
    if (!ok) return;
    const res = await fetch(`/api/competitions/${competitionId}/entries/${entryId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed");
      return;
    }
    toast.success("Removed");
    router.refresh();
  }

  // Sort: explicit placements first (in placement order), then the rest
  // ordered by the discipline-specific tie-break rule, with name as a
  // final fallback. Withdrawn entries sink to the bottom regardless.
  const placed = entries.filter((e) => e.placement !== null).sort((a, b) => a.placement! - b.placement!);
  const live = entries.filter((e) => e.placement === null && e.status !== "withdrawn");
  const liveRanked = rankEntries(engine, live).sort((a, b) => {
    const aHas = a.score !== null || a.faults !== null || a.time !== null;
    const bHas = b.score !== null || b.faults !== null || b.time !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return 0; // rankEntries already ordered the rest
  });
  // Stable tie-break on name when discipline rank says equal
  const tied: Entry[] = liveRanked.slice();
  tied.sort((a, b) => {
    const r = rankEntries(engine, [a, b]);
    if (r[0]!.id === a.id) return -1;
    return 1;
  });
  const withdrawn = entries.filter((e) => e.status === "withdrawn");
  const sorted = [...placed, ...liveRanked, ...withdrawn];

  const remaining = cls.maxEntries ? cls.maxEntries - entries.filter((e) => e.status !== "withdrawn").length : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            {cls.name}{" "}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {cls.discipline && `· ${disciplineLabel(cls.discipline)}`}
              {cls.ageGroup && ` · age ${cls.ageGroup}`}
              {cls.fee > 0 && ` · ₹${cls.fee} entry`}
              {cls.maxEntries && ` · ${entries.length}/${cls.maxEntries}`}
            </span>
          </CardTitle>
          {remaining !== null && remaining <= 0 && <Badge variant="destructive">full</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sorted.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No entries in this class yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2">Place</th>
                <th className="pb-2">Rider</th>
                <th className="pb-2">Team</th>
                <th className="pb-2">Score</th>
                <th className="pb-2">Faults</th>
                <th className="pb-2">Time (s)</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Paid</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="py-2">
                    {canManage ? (
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        defaultValue={e.placement ?? ""}
                        onBlur={(ev) => {
                          const v = ev.target.value === "" ? null : Number(ev.target.value);
                          if (v === e.placement) return;
                          updateEntry(e.id, { placement: v }, v === 1 ? "🥇" : v === 2 ? "🥈" : v === 3 ? "🥉" : "Placement saved");
                        }}
                        className="h-8 w-16 text-sm"
                      />
                    ) : e.placement !== null ? (
                      <Badge variant={e.placement === 1 ? "success" : e.placement <= 3 ? "warning" : "outline"}>
                        {e.placement === 1 ? "🥇 1st" : e.placement === 2 ? "🥈 2nd" : e.placement === 3 ? "🥉 3rd" : `${e.placement}th`}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 font-medium">{e.riderName}</td>
                  <td className="py-2 text-xs text-muted-foreground">{e.teamName ?? "—"}</td>
                  <td className="py-2">
                    {canManage ? (
                      <Input
                        type="number"
                        step="0.1"
                        defaultValue={e.score ?? ""}
                        onBlur={(ev) => {
                          const v = ev.target.value === "" ? null : Number(ev.target.value);
                          if (v === e.score) return;
                          updateEntry(e.id, { score: v });
                        }}
                        className="h-8 w-20 text-sm"
                      />
                    ) : (
                      <span>{e.score ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-2">
                    {canManage ? (
                      <Input
                        type="number"
                        step="0.1"
                        defaultValue={e.faults ?? ""}
                        onBlur={(ev) => {
                          const v = ev.target.value === "" ? null : Number(ev.target.value);
                          if (v === e.faults) return;
                          updateEntry(e.id, { faults: v });
                        }}
                        className="h-8 w-16 text-sm"
                      />
                    ) : (
                      <span>{e.faults ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-2">
                    {canManage ? (
                      <Input
                        type="number"
                        step="0.01"
                        defaultValue={e.time ?? ""}
                        onBlur={(ev) => {
                          const v = ev.target.value === "" ? null : Number(ev.target.value);
                          if (v === e.time) return;
                          updateEntry(e.id, { time: v });
                        }}
                        className="h-8 w-20 text-sm"
                      />
                    ) : (
                      <span>{e.time ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-2">
                    <Badge variant={e.status === "entered" ? "outline" : "destructive"}>{e.status}</Badge>
                  </td>
                  <td className="py-2">
                    {canManage && cls.fee > 0 ? (
                      <button
                        type="button"
                        onClick={() => updateEntry(e.id, { paid: !e.paid }, e.paid ? "Marked unpaid" : "Marked paid")}
                        className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted"
                      >
                        {e.paid ? "Paid" : "Unpaid"}
                      </button>
                    ) : (
                      <Badge variant={e.paid ? "success" : "outline"}>{e.paid ? "paid" : "—"}</Badge>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => deleteEntry(e.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-xs text-muted-foreground">
          Scoring: <strong>{rules.label}</strong> · ranking by {rules.primaryColumn}
        </div>

        {canManage && acceptingEntries && riders.length > 0 && (
          <form onSubmit={addEntry} className="grid gap-2 border-t pt-4 md:grid-cols-6 md:items-end">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs uppercase text-muted-foreground">Rider</label>
              <Select value={newRiderId} onChange={(e) => setNewRiderId(e.target.value)}>
                {riders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs uppercase text-muted-foreground">Horse (optional)</label>
              <Select value={newHorseId} onChange={(e) => setNewHorseId(e.target.value)}>
                <option value="">(none)</option>
                {horses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase text-muted-foreground">Team (optional)</label>
              <Select value={newTeamId} onChange={(e) => setNewTeamId(e.target.value)}>
                <option value="">(none)</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={adding} variant="outline" size="sm">
              <Plus className="h-3.5 w-3.5" /> {adding ? "Adding…" : "Enter"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
