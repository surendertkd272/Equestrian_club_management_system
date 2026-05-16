"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { openConfirm } from "@/components/ui/confirm-dialog";

type Round = {
  id: string;
  className: string;
  roundNumber: number;
  name: string;
  phase: string | null;
};

const EVENTING_PHASES = ["dressage", "cross_country", "show_jumping"];

export function RoundsPanel({
  competitionId,
  canManage,
  classNames,
  discipline,
  rounds,
}: {
  competitionId: string;
  canManage: boolean;
  classNames: string[];
  discipline: string;
  rounds: Round[];
}) {
  const router = useRouter();
  const [className, setClassName] = useState(classNames[0] ?? "");
  const [name, setName] = useState("");
  const [phase, setPhase] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!className || !name) {
      toast.error("Class and round name are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/rounds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className, name, phase: phase || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Failed");
        return;
      }
      toast.success("Round added");
      setName("");
      setPhase("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const ok = await openConfirm({
      title: "Remove this round?",
      body: "All per-entry scores for this round will be deleted.",
      destructive: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    const res = await fetch(`/api/competitions/${competitionId}/rounds/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed");
      return;
    }
    toast.success("Removed");
    router.refresh();
  }

  // Group by class for readability.
  const byClass = new Map<string, Round[]>();
  for (const r of rounds) {
    if (!byClass.has(r.className)) byClass.set(r.className, []);
    byClass.get(r.className)!.push(r);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Rounds / Phases</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rounds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rounds configured. Add a round (e.g. &quot;Round 1&quot;, &quot;Jump-off&quot;) and judges can
            score per round. Per-entry aggregates roll up automatically.
          </p>
        ) : (
          Array.from(byClass.entries()).map(([cls, rs]) => (
            <div key={cls}>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{cls}</div>
              <ul className="space-y-1 text-sm">
                {rs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded border px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">#{r.roundNumber}</Badge>
                      <span className="font-medium">{r.name}</span>
                      {r.phase && (
                        <Badge variant="outline" className="text-[10px] uppercase">{r.phase.replace("_", " ")}</Badge>
                      )}
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        {canManage && classNames.length > 0 && (
          <div className="grid gap-2 border-t pt-3 md:grid-cols-5 md:items-end">
            <div className="md:col-span-2">
              <label className="text-xs uppercase text-muted-foreground">Class</label>
              <Select value={className} onChange={(e) => setClassName(e.target.value)}>
                {classNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs uppercase text-muted-foreground">Round name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Round 1" or "Jump-off"' />
            </div>
            {discipline === "eventing" ? (
              <div>
                <label className="text-xs uppercase text-muted-foreground">Phase</label>
                <Select value={phase} onChange={(e) => setPhase(e.target.value)}>
                  <option value="">(none)</option>
                  {EVENTING_PHASES.map((p) => (
                    <option key={p} value={p}>{p.replace("_", " ")}</option>
                  ))}
                </Select>
              </div>
            ) : (
              <Button onClick={add} disabled={busy} size="sm">
                <Plus className="h-3.5 w-3.5" /> Add round
              </Button>
            )}
            {discipline === "eventing" && (
              <Button onClick={add} disabled={busy} size="sm" className="md:col-span-5">
                <Plus className="h-3.5 w-3.5" /> Add round
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
