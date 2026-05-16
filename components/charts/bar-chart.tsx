// Pure-CSS horizontal bar chart. No JS, no chart lib dep — server-rendered SVG-free.
// Pass an array of { label, value } and an optional max; bars scale to the max value.

import { cn } from "@/lib/utils";

export type BarDatum = { label: string; value: number; sub?: string };

export function BarChart({
  data,
  max,
  unit,
  emptyMessage = "No data.",
  accent = "bg-primary",
}: {
  data: BarDatum[];
  max?: number;
  unit?: string;
  emptyMessage?: string;
  accent?: string;
}) {
  if (data.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  const computedMax = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2">
      {data.map((d) => {
        const pct = Math.min(100, Math.max(0, (d.value / computedMax) * 100));
        return (
          <li key={d.label} className="grid grid-cols-[140px_1fr_64px] items-center gap-3 text-sm">
            <div className="truncate">{d.label}</div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full transition-all", accent)} style={{ width: `${pct}%` }} />
            </div>
            <div className="text-right text-xs">
              <span className="font-mono font-semibold">{d.value.toLocaleString("en-IN")}</span>
              {unit && <span className="ml-0.5 text-muted-foreground">{unit}</span>}
              {d.sub && <div className="text-[10px] text-muted-foreground">{d.sub}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
