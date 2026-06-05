import Link from "next/link";
import { cn } from "@/lib/utils";

type Tone = "default" | "amber" | "rose" | "green" | "primary";

const VALUE_TONE: Record<Tone, string> = {
  default: "text-foreground",
  primary: "text-primary",
  green: "text-emerald-600",
  amber: "text-amber-700",
  rose: "text-rose-600",
};

// The shared dashboard KPI tile — soft rounded card with an optional icon in a
// circle, a big value, an optional sub-line and delta. Matches the reference
// dashboard look; every per-role / per-portal dashboard renders through this so
// the whole system stays visually consistent.
export function StatTile({
  label,
  value,
  sub,
  delta,
  icon,
  tone = "default",
  link,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  delta?: { value: string; dir: "up" | "down" };
  icon?: React.ReactNode;
  tone?: Tone;
  link?: string;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-colors",
        link && "hover:border-primary/40 hover:bg-muted/30",
        className,
      )}
    >
      {icon && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className={cn("text-2xl font-bold leading-none", VALUE_TONE[tone])}>{value}</span>
          {delta && (
            <span className={cn("text-[11px] font-semibold", delta.dir === "up" ? "text-emerald-600" : "text-rose-600")}>
              {delta.dir === "up" ? "↑" : "↓"} {delta.value}
            </span>
          )}
        </div>
        {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
  return link ? (
    <Link href={link} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
