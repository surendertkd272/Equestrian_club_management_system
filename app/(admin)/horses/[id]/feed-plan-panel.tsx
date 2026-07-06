"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Item = { feed: string; qty: number; unit: string };
type Ration = { time: string; items: Item[] };

const DEFAULT_PLAN: Ration[] = [
  { time: "morning", items: [{ feed: "Hay", qty: 5, unit: "kg" }] },
  { time: "noon", items: [{ feed: "Oats", qty: 2, unit: "kg" }] },
  { time: "evening", items: [{ feed: "Hay", qty: 5, unit: "kg" }] },
];

export function FeedPlanPanel({
  horseId,
  canManage,
  initial,
}: {
  horseId: string;
  canManage: boolean;
  // rations comes from a native jsonb column — it's a parsed value of unknown
  // shape until narrowed below.
  initial: { rations: unknown; notes: string } | null;
}) {
  const router = useRouter();
  // Tolerant narrow: jsonb returns the parsed value directly, but if a legacy
  // row stored it as a string we still want to recover it. Bad data → defaults.
  const seedRations: Ration[] = (() => {
    const v = initial?.rations;
    if (!v) return DEFAULT_PLAN;
    try {
      const arr = typeof v === "string" ? JSON.parse(v) : v;
      return Array.isArray(arr) ? (arr as Ration[]) : DEFAULT_PLAN;
    } catch {
      return DEFAULT_PLAN;
    }
  })();
  const [rations, setRations] = useState<Ration[]>(seedRations);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  function setRation(i: number, patch: Partial<Ration>) {
    setRations((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function setItem(rationIdx: number, itemIdx: number, patch: Partial<Item>) {
    setRations((r) =>
      r.map((row, idx) =>
        idx === rationIdx
          ? { ...row, items: row.items.map((it, ii) => (ii === itemIdx ? { ...it, ...patch } : it)) }
          : row,
      ),
    );
  }
  function addItem(rationIdx: number) {
    setRations((r) => r.map((row, idx) => (idx === rationIdx ? { ...row, items: [...row.items, { feed: "", qty: 1, unit: "kg" }] } : row)));
  }
  function removeItem(rationIdx: number, itemIdx: number) {
    setRations((r) =>
      r.map((row, idx) =>
        idx === rationIdx
          ? { ...row, items: row.items.length > 1 ? row.items.filter((_, ii) => ii !== itemIdx) : row.items }
          : row,
      ),
    );
  }
  function addRation() {
    setRations((r) => [...r, { time: "snack", items: [{ feed: "", qty: 1, unit: "kg" }] }]);
  }
  function removeRation(i: number) {
    setRations((r) => (r.length === 1 ? r : r.filter((_, idx) => idx !== i)));
  }

  async function save() {
    // Strip empty rows so the schema validator doesn't reject the whole plan.
    const cleaned = rations
      .map((r) => ({ ...r, items: r.items.filter((it) => it.feed.trim() && it.qty > 0) }))
      .filter((r) => r.items.length > 0);
    if (cleaned.length === 0) {
      toast.error("Add at least one feed item.");
      return;
    }
    setBusy(true);
    let res: Response;
    try {
      res = await fetch(`/api/horses/${horseId}/feed-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rations: cleaned, notes: notes.trim() || null }),
      });
    } catch {
      setBusy(false);
      toast.error("Couldn't reach the server — check your connection and try again.");
      return;
    }
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.message ?? data.error ?? "Failed");
      return;
    }
    toast.success("Feed plan saved.");
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="space-y-3 text-sm">
        {seedRations.length ? (
          <ul className="divide-y">
            {seedRations.map((r, i) => (
              <li key={i} className="py-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{r.time}</div>
                <div className="mt-1">
                  {r.items.map((it, ii) => (
                    <span key={ii} className="mr-3">
                      {it.feed} · <strong>{it.qty}{it.unit}</strong>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No feed plan set yet.</p>
        )}
        {initial?.notes ? <p className="text-xs italic text-muted-foreground">{initial.notes}</p> : null}
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {seedRations.length ? "Edit plan" : "Set up feed plan"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rations.map((r, ri) => (
        <div key={ri} className="rounded-md border p-3">
          <div className="mb-2 flex items-center gap-2">
            <Label className="text-xs">Time Slot</Label>
            <Input aria-label="Time slot"
              value={r.time}
              onChange={(e) => setRation(ri, { time: e.target.value })}
              className="h-8 max-w-[180px]"
              placeholder="morning / noon / evening"
            />
            {rations.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => removeRation(ri)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-1">Feed</th>
                <th className="pb-1 w-24">Qty</th>
                <th className="pb-1 w-24">Unit</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.items.map((it, ii) => (
                <tr key={ii}>
                  <td className="py-1 pr-2">
                    <Input value={it.feed} onChange={(e) => setItem(ri, ii, { feed: e.target.value })} placeholder="Hay / Oats / Mash" />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      type="number"
                      step="0.1"
                      value={it.qty}
                      onChange={(e) => setItem(ri, ii, { qty: Number(e.target.value) })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input value={it.unit} onChange={(e) => setItem(ri, ii, { unit: e.target.value })} placeholder="kg" />
                  </td>
                  <td className="py-1 text-right">
                    <Button variant="ghost" size="sm" onClick={() => removeItem(ri, ii)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button variant="outline" size="sm" type="button" onClick={() => addItem(ri)} className="mt-2">
            <Plus className="mr-1 h-3 w-3" /> Add item
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" type="button" onClick={addRation}>
        <Plus className="mr-1 h-3 w-3" /> Add time slot
      </Button>
      <div>
        <Label className="text-xs">Notes</Label>
        <Input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergic to lucerne · prefers warm mash on cold mornings" />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save plan"}</Button>
      </div>
    </div>
  );
}
