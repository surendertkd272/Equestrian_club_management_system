"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Rider = { id: string; firstName: string; lastName: string };
type Horse = { id: string; name: string; stableNo: string | null };
type Pair = { riderId: string; horseId: string; notes: string };

export function AllocationGrid({
  lessonId,
  riders,
  horses,
  initial,
}: {
  lessonId: string;
  riders: Rider[];
  horses: Horse[];
  initial: Pair[];
}) {
  const router = useRouter();
  const [pairs, setPairs] = useState<Pair[]>(initial.length > 0 ? initial : [{ riderId: "", horseId: "", notes: "" }]);
  const [busy, setBusy] = useState(false);

  function setRow(i: number, patch: Partial<Pair>) {
    setPairs((p) => p.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setPairs((p) => [...p, { riderId: "", horseId: "", notes: "" }]);
  }
  function removeRow(i: number) {
    setPairs((p) => (p.length === 1 ? [{ riderId: "", horseId: "", notes: "" }] : p.filter((_, idx) => idx !== i)));
  }

  async function save() {
    const filled = pairs.filter((p) => p.riderId && p.horseId);
    if (filled.length === 0) {
      toast.error("Add at least one rider-horse pairing.");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/lessons/${lessonId}/allocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairings: filled.map((p) => ({ riderId: p.riderId, horseId: p.horseId, notes: p.notes || null })),
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error === "HORSE_DOUBLE_BOOKED") {
        toast.error("One or more horses are already booked in another lesson at this time.");
      } else if (data.error === "DUPLICATE_HORSE" || data.error === "DUPLICATE_RIDER") {
        toast.error(data.message ?? "Duplicate entry.");
      } else {
        toast.error(data.error ?? "Failed");
      }
      return;
    }
    toast.success(`${data.count} pairing${data.count === 1 ? "" : "s"} saved.`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="pb-2">Rider</th>
            <th className="pb-2">Horse</th>
            <th className="pb-2">Notes</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {pairs.map((p, i) => (
            <tr key={i}>
              <td className="py-2 pr-2">
                <select
                  value={p.riderId}
                  onChange={(e) => setRow(i, { riderId: e.target.value })}
                  className="h-9 w-full rounded border bg-card px-2"
                >
                  <option value="">— Select rider —</option>
                  {riders.map((r) => (
                    <option key={r.id} value={r.id}>{r.firstName} {r.lastName}</option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-2">
                <select
                  value={p.horseId}
                  onChange={(e) => setRow(i, { horseId: e.target.value })}
                  className="h-9 w-full rounded border bg-card px-2"
                >
                  <option value="">— Select horse —</option>
                  {horses.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}{h.stableNo ? ` (${h.stableNo})` : ""}</option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-2">
                <Input
                  value={p.notes}
                  onChange={(e) => setRow(i, { notes: e.target.value })}
                  placeholder="Optional"
                />
              </td>
              <td className="py-2 text-right">
                <Button variant="ghost" size="sm" type="button" onClick={() => removeRow(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between">
        <Button variant="outline" type="button" onClick={addRow}>
          <Plus className="mr-1 h-4 w-4" /> Add pairing
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save allocations"}
        </Button>
      </div>
    </div>
  );
}
