import { cn } from "@/lib/utils";

// Dependency-free, server-renderable mini-charts built on inline SVG. They use
// the design tokens (primary / muted-foreground) via Tailwind classes, so they
// adapt to light/dark automatically — no charting library, no client JS.

// ── Sparkline ────────────────────────────────────────────────────────────────
// A smooth trend line with an optional soft area fill. Pass any numeric series.
export function Sparkline({
  data,
  className,
  strokeClass = "stroke-primary",
  fillClass = "fill-primary/10",
  area = true,
  strokeWidth = 2,
}: {
  data: number[];
  className?: string;
  strokeClass?: string;
  fillClass?: string;
  area?: boolean;
  strokeWidth?: number;
}) {
  const W = 100;
  const H = 32;
  const pad = strokeWidth; // keep the stroke from clipping at the edges
  if (!data || data.length === 0) return <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-8 w-full", className)} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? (W - pad * 2) / (data.length - 1) : 0;

  const pts = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (H - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });

  // single point → draw a flat midline so the card isn't blank
  const line = pts.length === 1
    ? `${pad},${H / 2} ${W - pad},${H / 2}`
    : pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

  const areaPath = pts.length > 1
    ? `M ${pts[0][0].toFixed(2)},${H} L ${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L ")} L ${pts[pts.length - 1][0].toFixed(2)},${H} Z`
    : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-8 w-full overflow-visible", className)}>
      {area && pts.length > 1 && <path d={areaPath} className={fillClass} stroke="none" />}
      <polyline
        points={line}
        fill="none"
        className={strokeClass}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── MiniBars ─────────────────────────────────────────────────────────────────
// Compact bar chart. The last bar is highlighted in primary; the rest are muted
// — mirrors the "this month is taller and coloured" look from the reference.
export function MiniBars({
  data,
  className,
  highlightLast = true,
  barClass = "fill-primary/25",
  activeClass = "fill-primary",
  rounded = 1.5,
}: {
  data: number[];
  className?: string;
  highlightLast?: boolean;
  barClass?: string;
  activeClass?: string;
  rounded?: number;
}) {
  const W = 100;
  const H = 32;
  if (!data || data.length === 0) return <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-8 w-full", className)} />;

  const max = Math.max(...data, 1);
  const gap = data.length > 12 ? 1 : 2;
  const bw = (W - gap * (data.length - 1)) / data.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-8 w-full", className)}>
      {data.map((v, i) => {
        const h = Math.max(2, (v / max) * (H - 2));
        const x = i * (bw + gap);
        const y = H - h;
        const isLast = highlightLast && i === data.length - 1;
        return (
          <rect
            key={i}
            x={x.toFixed(2)}
            y={y.toFixed(2)}
            width={bw.toFixed(2)}
            height={h.toFixed(2)}
            rx={rounded}
            className={isLast ? activeClass : barClass}
          />
        );
      })}
    </svg>
  );
}

// ── RingGauge ────────────────────────────────────────────────────────────────
// A circular progress dial — the focal "Speed Statistic" equivalent. Renders a
// big centred value with an optional caption underneath.
export function RingGauge({
  value,
  max = 100,
  size = 132,
  thickness = 12,
  label,
  caption,
  trackClass = "stroke-muted",
  progressClass = "stroke-primary",
  className,
}: {
  value: number;
  max?: number;
  size?: number;
  thickness?: number;
  label?: React.ReactNode;
  caption?: string;
  trackClass?: string;
  progressClass?: string;
  className?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const dash = c * pct;

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} className={trackClass} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dash.toFixed(2)} ${(c - dash).toFixed(2)}`}
          className={progressClass}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {label && <span className="text-2xl font-bold leading-none text-foreground">{label}</span>}
        {caption && <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{caption}</span>}
      </div>
    </div>
  );
}
