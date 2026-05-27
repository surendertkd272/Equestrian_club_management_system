"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { TRIP_ITEM_CATEGORIES } from "@/lib/schemas/venue-trip";

type Item = {
  id: string;
  category: string;
  label: string;
  qtyExpected: number;
  checkedOut: boolean;
  conditionOut: string | null;
  checkedIn: boolean;
  conditionIn: string | null;
  remarks: string | null;
};

export function TripManifest({
  tripId,
  status,
  items,
}: {
  tripId: string;
  status: string;
  items: Item[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ category: "tack", label: "", qtyExpected: "1" });

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  async function add() {
    if (draft.label.trim().length < 1) {
      toast.error("Enter an item label.");
      return;
    }
    setBusy("__new__");
    try {
      const res = await fetch(`/api/venue-trips/${tripId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: draft.category,
          label: draft.label.trim(),
          qtyExpected: Number(draft.qtyExpected) || 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      setDraft((d) => ({ ...d, label: "", qtyExpected: "1" }));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function check(itemId: string, phase: "out" | "in", checked: boolean, condition?: string) {
    setBusy(itemId + phase);
    try {
      const res = await fetch(`/api/venue-trips/${tripId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, checked, condition }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function removeItem(itemId: string) {
    setBusy(itemId + "del");
    try {
      const res = await fetch(`/api/venue-trips/${tripId}/items/${itemId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(next: string) {
    setBusy("__status__");
    try {
      const res = await fetch(`/api/venue-trips/${tripId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed");
        return;
      }
      toast.success(`Marked ${next}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const allOut = items.length > 0 && items.every((i) => i.checkedOut);
  const allIn = items.length > 0 && items.every((i) => i.checkedIn);

  return (
    <div className="space-y-4">
      {/* Status controls */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
        <span className="text-muted-foreground">Trip status:</span>
        <Badge variant="outline">{status}</Badge>
        <div className="ml-auto flex gap-2">
          {status === "planned" && (
            <Button size="sm" variant="outline" onClick={() => setStatus("departed")} disabled={busy !== null || !allOut}>
              Mark departed
            </Button>
          )}
          {status === "departed" && (
            <Button size="sm" onClick={() => setStatus("returned")} disabled={busy !== null}>
              Mark returned
            </Button>
          )}
          {status !== "returned" && status !== "cancelled" && (
            <Button size="sm" variant="ghost" onClick={() => setStatus("cancelled")} disabled={busy !== null}>
              Cancel trip
            </Button>
          )}
        </div>
      </div>
      {status === "planned" && !allOut && items.length > 0 && (
        <p className="text-xs text-amber-700">Check every item OUT before marking the trip departed.</p>
      )}

      {/* Add item */}
      <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
        <div className="w-32">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Category</label>
          <Select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
            {TRIP_ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Item</label>
          <Input
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="e.g. Raja (horse) · Dressage saddle · Feed bin"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
        </div>
        <div className="w-20">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Qty</label>
          <Input type="number" value={draft.qtyExpected} onChange={(e) => setDraft((d) => ({ ...d, qtyExpected: e.target.value }))} />
        </div>
        <Button onClick={add} disabled={busy === "__new__"}>Add</Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
          No items yet. Build the manifest above.
        </div>
      ) : (
        grouped.map(([cat, rows]) => (
          <div key={cat} className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{cat}</div>
            <ul className="divide-y rounded-md border">
              {rows.map((it) => {
                const inIssue = it.checkedIn && it.conditionIn && it.conditionIn !== "ok";
                return (
                  <li key={it.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-[160px] flex-1 text-sm">
                      {it.label}
                      {it.qtyExpected > 1 && <span className="ml-1 text-xs text-muted-foreground">×{it.qtyExpected}</span>}
                    </span>
                    {/* OUT */}
                    <CheckButton
                      label="OUT"
                      checked={it.checkedOut}
                      disabled={busy === it.id + "out"}
                      onToggle={() => check(it.id, "out", !it.checkedOut, !it.checkedOut ? "ok" : undefined)}
                    />
                    {/* IN — only meaningful after departure */}
                    <CheckButton
                      label="IN"
                      checked={it.checkedIn}
                      disabled={busy === it.id + "in"}
                      onToggle={() => check(it.id, "in", !it.checkedIn, !it.checkedIn ? "ok" : undefined)}
                    />
                    {/* Flag damaged/missing on return */}
                    {it.checkedIn && (
                      <Select
                        className="h-8 w-28 text-xs"
                        value={it.conditionIn ?? "ok"}
                        onChange={(e) => check(it.id, "in", true, e.target.value)}
                      >
                        <option value="ok">ok</option>
                        <option value="damaged">damaged</option>
                        <option value="missing">missing</option>
                      </Select>
                    )}
                    {inIssue && <Badge variant="warning">{it.conditionIn}</Badge>}
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem(it.id)}
                      disabled={busy === it.id + "del"}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      {allIn && items.length > 0 && (
        <p className="text-xs text-emerald-700">All items checked back in. ✓</p>
      )}
    </div>
  );
}

function CheckButton({
  label,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`rounded-md border px-2 py-1 text-xs font-medium transition ${
        checked
          ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "border-input bg-background text-muted-foreground hover:bg-muted"
      }`}
    >
      {checked ? "✓ " : ""}{label}
    </button>
  );
}
