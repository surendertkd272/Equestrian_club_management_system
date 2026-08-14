"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/client/post-json";

export type PickerRider = {
  id: string;
  name: string;
  batchId: string | null;
  batchName: string | null;
};

// "Who is in this batch?" from the batch's own side.
//
// Membership could only be set from the rider detail page, one rider at a time.
// But a manager setting up a Tuesday batch thinks in terms of the batch — "these
// twelve riders" — not "let me go and edit twelve rider records". That mismatch
// is a large part of why 94 of 99 riders ended up with no batch at all, which
// in turn left the attendance register empty for nearly every coach.
export function ManageRiders({
  batchId,
  batchName,
  riders,
}: {
  batchId: string;
  batchName: string;
  riders: PickerRider[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const initial = useMemo(
    () => new Set(riders.filter((r) => r.batchId === batchId).map((r) => r.id)),
    [riders, batchId],
  );
  const [picked, setPicked] = useState<Set<string>>(initial);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    const rows = t ? riders.filter((r) => r.name.toLowerCase().includes(t)) : riders;
    // Members first, then riders free to join, then those in another batch —
    // moving someone out of another batch should be a deliberate act, not the
    // first thing under your cursor.
    return [...rows].sort((a, b) => {
      const rank = (r: PickerRider) => (r.batchId === batchId ? 0 : r.batchId === null ? 1 : 2);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
  }, [riders, q, batchId]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const added = [...picked].filter((id) => !initial.has(id));
  const removed = [...initial].filter((id) => !picked.has(id));
  const dirty = added.length > 0 || removed.length > 0;

  async function save() {
    setBusy(true);
    try {
      if (added.length > 0) {
        const res = await postJson("/api/riders/bulk-batch", { riderIds: added, batchId });
        if (!res.ok) return toast.error(res.message);
      }
      if (removed.length > 0) {
        const res = await postJson("/api/riders/bulk-batch", { riderIds: removed, batchId: null });
        if (!res.ok) return toast.error(res.message);
      }
      toast.success(
        `${batchName}: ${added.length} added${removed.length ? `, ${removed.length} removed` : ""}`,
      );
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Riders
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Riders in ${batchName}`}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border bg-card shadow-xl"
      >
        <div className="border-b p-4">
          <h2 className="font-semibold">Riders in {batchName}</h2>
          <p className="text-xs text-muted-foreground">
            Ticked riders are in this batch. Attendance can only be marked for riders in a batch.
          </p>
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search riders…"
            className="mt-3 h-8"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No riders match.</p>
          ) : (
            <ul className="space-y-0.5">
              {visible.map((r) => {
                const elsewhere = r.batchId && r.batchId !== batchId;
                return (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={picked.has(r.id)}
                        onChange={() => toggle(r.id)}
                      />
                      <span className="flex-1">{r.name}</span>
                      {elsewhere && (
                        <span className="text-[11px] text-amber-600">in {r.batchName}</span>
                      )}
                      {!r.batchId && (
                        <span className="text-[11px] text-muted-foreground">no batch</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t p-3">
          <span className="text-xs text-muted-foreground">
            {dirty
              ? `${added.length} to add${removed.length ? `, ${removed.length} to remove` : ""}`
              : `${picked.size} in this batch`}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
