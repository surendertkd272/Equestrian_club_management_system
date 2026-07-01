"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { openConfirm } from "@/components/ui/confirm-dialog";
import { formatDate } from "@/lib/utils";

export type BinRow = {
  entity: "vendor" | "medicine" | "consumable" | "team";
  id: string;
  name: string;
  deletedAt: string | null;
};

export function BinList({
  rows,
  retentionDays,
  labels,
}: {
  rows: BinRow[];
  retentionDays: number;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(row: BinRow, action: "restore" | "purge") {
    if (action === "purge") {
      const ok = await openConfirm({
        title: "Delete permanently?",
        body: `"${row.name}" will be erased for good. This can't be undone.`,
        confirmLabel: "Delete Forever",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(row.entity + row.id);
    try {
      const res = await fetch("/api/bin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: row.entity, id: row.id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success(action === "restore" ? "Restored" : "Permanently deleted");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function purgeInfo(deletedAt: string | null): { label: string; soon: boolean } {
    if (!deletedAt) return { label: "—", soon: false };
    const purgeAt = new Date(new Date(deletedAt).getTime() + retentionDays * 86400000);
    const daysLeft = Math.ceil((purgeAt.getTime() - Date.now()) / 86400000);
    return { label: daysLeft <= 0 ? "purging soon" : `in ${daysLeft}d`, soon: daysLeft <= 5 };
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="pb-2">Item</th>
            <th className="pb-2">Type</th>
            <th className="pb-2">Deleted</th>
            <th className="pb-2">Auto-purge</th>
            <th className="pb-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const p = purgeInfo(row.deletedAt);
            const key = row.entity + row.id;
            return (
              <tr key={key} className="border-t">
                <td className="py-2 font-medium">{row.name}</td>
                <td className="py-2"><Badge variant="outline">{labels[row.entity] ?? row.entity}</Badge></td>
                <td className="py-2 text-xs text-muted-foreground">{row.deletedAt ? formatDate(new Date(row.deletedAt)) : "—"}</td>
                <td className={`py-2 text-xs ${p.soon ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>{p.label}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" disabled={busy === key} onClick={() => act(row, "restore")}>
                    {busy === key ? "…" : "Restore"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === key} onClick={() => act(row, "purge")}>
                    Delete Now
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
