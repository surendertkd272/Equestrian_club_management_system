"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Item = {
  id: string;
  area: string;
  label: string;
  result: string;
  remarks: string | null;
};

const RESULTS: { key: string; label: string; cls: string }[] = [
  { key: "pass", label: "Pass", cls: "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  { key: "fail", label: "Fail", cls: "border-rose-600 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
  { key: "na", label: "N/A", cls: "border-zinc-400 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" },
];

export function InspectionSheet({
  runId,
  completed,
  summary: initialSummary,
  items,
}: {
  runId: string;
  completed: boolean;
  summary: string | null;
  items: Item[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState(initialSummary ?? "");

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      if (!map.has(it.area)) map.set(it.area, []);
      map.get(it.area)!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  const pending = items.filter((i) => i.result === "pending").length;

  async function mark(itemId: string, result: string, remarks?: string) {
    setBusy(itemId);
    try {
      const res = await fetch(`/api/inspections/${runId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, remarks }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function complete() {
    setBusy("__complete__");
    try {
      const res = await fetch(`/api/inspections/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: summary.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message ?? data.error ?? "Failed");
        return;
      }
      toast.success("Audit completed");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {grouped.map(([area, rows]) => (
        <div key={area} className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{area}</div>
          <ul className="divide-y rounded-md border">
            {rows.map((it) => (
              <li key={it.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[180px] flex-1 text-sm">{it.label}</span>
                  <div className="flex gap-2">
                    {RESULTS.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        disabled={completed || busy === it.id}
                        onClick={() => mark(it.id, r.key, it.remarks ?? undefined)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                          it.result === r.key ? r.cls : "border-input bg-background text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                {(it.result === "fail" || it.remarks) && !completed && (
                  <Input
                    className="mt-2"
                    placeholder="Remarks (what's wrong / action needed)"
                    defaultValue={it.remarks ?? ""}
                    onBlur={(e) => {
                      if (e.target.value !== (it.remarks ?? "")) mark(it.id, it.result === "pending" ? "fail" : it.result, e.target.value);
                    }}
                    maxLength={300}
                  />
                )}
                {completed && it.remarks && (
                  <p className="mt-1 text-xs text-muted-foreground">Remarks: {it.remarks}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {!completed ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Summary / overall remarks</label>
          <Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {pending > 0 ? `${pending} line${pending === 1 ? "" : "s"} still pending` : "All lines marked."}
            </span>
            <Button onClick={complete} disabled={busy === "__complete__"}>
              {busy === "__complete__" ? "Completing…" : "Complete audit"}
            </Button>
          </div>
        </div>
      ) : (
        initialSummary && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Summary</div>
            <p className="mt-1">{initialSummary}</p>
          </div>
        )
      )}
    </div>
  );
}
