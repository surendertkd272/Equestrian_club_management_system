"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { formatDate } from "@/lib/utils";
import { formatEnum } from "@/lib/labels";
import { postJson } from "@/lib/client/post-json";

export type RiderRow = {
  id: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  joiningDate: Date | string | null;
  currentLevel: string | null;
  status: string;
  batchName: string | null;
};

const statusVariant = (s: string) =>
  s === "active" ? "success" : s === "pending_payment" ? "warning" : s === "suspended" ? "destructive" : "outline";

// Riders list with multi-select, so a batch can be filled in one action.
//
// Batch membership was previously settable one rider at a time from the rider
// detail page. Attendance rosters come from batch membership, so with 94 of 99
// riders unassigned the register was empty for nearly every coach and had never
// been marked once. Fixing that by hand meant 94 separate edits — which is why
// it never happened. This turns it into one.
export function RidersTable({
  riders,
  batches,
  canAssign,
}: {
  riders: RiderRow[];
  batches: { id: string; name: string }[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");

  const allOnPage = riders.length > 0 && riders.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => (allOnPage ? new Set() : new Set([...prev, ...riders.map((r) => r.id)])));

  async function assign() {
    if (selected.size === 0) return;
    setBusy(true);
    const res = await postJson<{ count: number }>("/api/riders/bulk-batch", {
      riderIds: [...selected],
      batchId: target || null,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    const name = batches.find((b) => b.id === target)?.name;
    toast.success(
      target
        ? `${res.data.count} rider${res.data.count === 1 ? "" : "s"} assigned to ${name}`
        : `${res.data.count} rider${res.data.count === 1 ? "" : "s"} removed from their batch`,
    );
    setSelected(new Set());
    router.refresh();
  }

  const selectColumn = canAssign
    ? [
        {
          key: "select",
          // Header is the select-all box; the visible label is for screen readers.
          header: (
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={allOnPage}
                onChange={toggleAll}
                aria-label="Select all riders on this page"
              />
              <span className="sr-only">Select all</span>
            </label>
          ),
          hideOnMobile: false,
          cell: (r: RiderRow) => (
            <input
              type="checkbox"
              checked={selected.has(r.id)}
              onChange={() => toggle(r.id)}
              aria-label={`Select ${r.firstName} ${r.lastName}`}
            />
          ),
        },
      ]
    : [];

  return (
    <>
      {canAssign && selected.size > 0 && (
        // Sticks to the bottom so the action stays reachable while scrolling a
        // long roll — selecting 40 riders then hunting for the button is worse
        // than the problem this solves.
        <div className="sticky bottom-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-lg">
          <span className="text-sm font-medium">
            {selected.size} rider{selected.size === 1 ? "" : "s"} selected
          </span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Batch to assign to"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">— remove from batch —</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={assign} disabled={busy}>
            {busy ? "Assigning…" : target ? "Assign to batch" : "Remove from batch"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={busy}>
            Clear
          </Button>
        </div>
      )}

      <ResponsiveTable
        rows={riders}
        getRowKey={(r) => r.id}
        emptyMessage="No riders match these filters."
        columns={[
          ...selectColumn,
          {
            key: "name",
            header: "Name",
            primary: true,
            cell: (r) => (
              <Link href={`/riders/${r.id}`} className="font-medium hover:underline">
                {r.firstName} {r.lastName}
              </Link>
            ),
          },
          { key: "mobile", header: "Mobile", numeric: true, cell: (r) => r.mobile },
          { key: "joined", header: "Joined", cell: (r) => formatDate(r.joiningDate as Date) },
          {
            key: "batch",
            header: "Batch",
            // Unassigned is called out rather than shown as a neutral dash:
            // it is the thing that silently disables the register.
            cell: (r) =>
              r.batchName ?? <span className="text-amber-600">not in a batch</span>,
          },
          { key: "level", header: "Level", cell: (r) => r.currentLevel ?? "—" },
          {
            key: "status",
            header: "Status",
            cell: (r) => <Badge variant={statusVariant(r.status) as any}>{formatEnum(r.status)}</Badge>,
          },
        ]}
      />
    </>
  );
}
