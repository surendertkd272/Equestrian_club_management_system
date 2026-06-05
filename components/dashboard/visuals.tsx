import Link from "next/link";
import { cn } from "@/lib/utils";

// Higher-level dashboard building blocks composed from the SVG primitives in
// components/ui/charts.tsx. All token-themed → adapt to light/dark on their own.

// ── ChartCard ────────────────────────────────────────────────────────────────
// A headline KPI: label, big value, optional delta, and an embedded mini-chart
// on the right (pass a <Sparkline/> or <MiniBars/>). This is the "hero row" tile
// — bigger and richer than the compact StatTile grid below it.
export function ChartCard({
  label,
  value,
  delta,
  sub,
  icon,
  chart,
  link,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: { value: string; dir: "up" | "down" };
  sub?: string;
  icon?: React.ReactNode;
  chart?: React.ReactNode;
  link?: string;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "flex h-full flex-col gap-3 rounded-2xl border border-border/60 bg-card p-5 shadow-sm transition-colors",
        link && "hover:border-primary/40 hover:bg-muted/20",
        className,
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              {icon}
            </div>
          )}
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold leading-none text-foreground">{value}</span>
              {delta && (
                <span className={cn("text-xs font-semibold", delta.dir === "up" ? "text-emerald-500" : "text-rose-500")}>
                  {delta.dir === "up" ? "↑" : "↓"} {delta.value}
                </span>
              )}
            </div>
            {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
          </div>
        </div>
        {chart && <div className="h-9 w-24 shrink-0 self-center">{chart}</div>}
      </div>
    </div>
  );
  return link ? <Link href={link} className="block h-full">{body}</Link> : body;
}

// ── HeroCard ─────────────────────────────────────────────────────────────────
// The illustrated gradient centrepiece that gives a dashboard its identity
// (next competition / featured rider / spotlight horse). Pure gradient + icon
// watermark — no image assets required.
export function HeroCard({
  kicker,
  title,
  subtitle,
  icon,
  stats,
  progress,
  href,
  cta,
  className,
}: {
  kicker: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  stats?: { label: string; value: React.ReactNode }[];
  progress?: { value: number; max: number; label?: string };
  href?: string;
  cta?: string;
  className?: string;
}) {
  const pct = progress && progress.max > 0 ? Math.min(100, Math.round((progress.value / progress.max) * 100)) : null;
  const body = (
    <div
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-violet-700 p-5 text-white shadow-sm",
        href && "transition-transform hover:-translate-y-0.5",
        className,
      )}
    >
      {/* decorative watermark + soft blobs */}
      {icon && <div className="pointer-events-none absolute -bottom-6 -right-4 opacity-15 [&>svg]:h-36 [&>svg]:w-36">{icon}</div>}
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />

      <div className="relative">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/70">{kicker}</div>
        <div className="mt-1 text-xl font-bold leading-tight">{title}</div>
        {subtitle && <div className="mt-0.5 text-sm text-white/80">{subtitle}</div>}
      </div>

      {progress && (
        <div className="relative mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
          </div>
          {progress.label && <div className="mt-1 text-[11px] text-white/80">{progress.label}</div>}
        </div>
      )}

      {stats && stats.length > 0 && (
        <div className="relative mt-auto grid grid-cols-3 gap-2 pt-4">
          {stats.slice(0, 3).map((s) => (
            <div key={s.label}>
              <div className="text-base font-bold leading-none">{s.value}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-white/70">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {cta && (
        <div className="relative mt-4 inline-flex items-center gap-1 text-xs font-semibold text-white/90">
          {cta} <span aria-hidden>→</span>
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

// ── ActivityTimeline ─────────────────────────────────────────────────────────
// Vertical step/activity list — the "Order Info" timeline equivalent. Each item
// is a dot on a connector line with a title, optional meta, and a trailing time.
export function ActivityTimeline({
  items,
  className,
}: {
  items: {
    title: React.ReactNode;
    meta?: React.ReactNode;
    time?: string;
    status?: "done" | "current" | "pending";
    href?: string;
  }[];
  className?: string;
}) {
  if (!items || items.length === 0) {
    return <p className={cn("text-sm text-muted-foreground", className)}>Nothing to show yet.</p>;
  }
  return (
    <ol className={cn("relative space-y-4", className)}>
      {items.map((it, i) => {
        const status = it.status ?? "pending";
        const isLast = i === items.length - 1;
        const dot =
          status === "done"
            ? "border-primary bg-primary"
            : status === "current"
            ? "border-primary bg-background ring-4 ring-primary/20"
            : "border-border bg-background";
        const row = (
          <div className="flex items-start gap-3">
            <div className="relative flex flex-col items-center">
              <span className={cn("z-10 mt-0.5 h-3 w-3 shrink-0 rounded-full border-2", dot)} />
              {!isLast && <span className="absolute top-3 h-[calc(100%+0.5rem)] w-px bg-border" />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm", status === "pending" ? "text-muted-foreground" : "font-medium text-foreground")}>
                  {it.title}
                </span>
                {it.time && <span className="shrink-0 text-xs text-muted-foreground">{it.time}</span>}
              </div>
              {it.meta && <div className="truncate text-xs text-muted-foreground">{it.meta}</div>}
            </div>
          </div>
        );
        return (
          <li key={i}>
            {it.href ? <Link href={it.href} className="block rounded-md transition-colors hover:bg-muted/40">{row}</Link> : row}
          </li>
        );
      })}
    </ol>
  );
}
