import Link from "next/link";
import { cn } from "@/lib/utils";

type Tone = "default" | "amber" | "rose" | "green" | "primary";
type Variant = "light" | "dark";

// Value colour per tone, per variant (the dark variant is for the owner portal
// which hardcodes a slate palette rather than the lavender tenant tokens).
const VALUE_TONE: Record<Variant, Record<Tone, string>> = {
  light: {
    default: "text-foreground",
    primary: "text-primary",
    green: "text-emerald-600",
    amber: "text-amber-700",
    rose: "text-rose-600",
  },
  dark: {
    default: "text-slate-100",
    primary: "text-primary",
    green: "text-emerald-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
  },
};

const CARD: Record<Variant, string> = {
  light: "border-border/60 bg-card",
  dark: "border-slate-800 bg-slate-900",
};
const CARD_HOVER: Record<Variant, string> = {
  light: "hover:border-primary/40 hover:bg-muted/30",
  dark: "hover:border-primary/50 hover:bg-slate-800/60",
};
const LABEL: Record<Variant, string> = {
  light: "text-muted-foreground",
  dark: "text-slate-400",
};
const SUB: Record<Variant, string> = {
  light: "text-muted-foreground",
  dark: "text-slate-500",
};

// The shared dashboard KPI tile — soft rounded card with an optional icon in a
// circle, a big value, an optional sub-line and delta. Every per-role /
// per-portal dashboard (tenant + owner) renders through this so the whole
// system stays visually consistent.
export function StatTile({
  label,
  value,
  sub,
  delta,
  icon,
  tone = "default",
  variant = "light",
  link,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  delta?: { value: string; dir: "up" | "down" };
  icon?: React.ReactNode;
  tone?: Tone;
  variant?: Variant;
  link?: string;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-4 shadow-sm transition-colors",
        CARD[variant],
        link && CARD_HOVER[variant],
        className,
      )}
    >
      {icon && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className={cn("text-[10px] font-medium uppercase tracking-wider", LABEL[variant])}>{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className={cn("text-2xl font-bold leading-none", VALUE_TONE[variant][tone])}>{value}</span>
          {delta && (
            <span className={cn("text-[11px] font-semibold", delta.dir === "up" ? "text-emerald-500" : "text-rose-500")}>
              {delta.dir === "up" ? "↑" : "↓"} {delta.value}
            </span>
          )}
        </div>
        {sub && <div className={cn("mt-0.5 truncate text-[11px]", SUB[variant])}>{sub}</div>}
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
