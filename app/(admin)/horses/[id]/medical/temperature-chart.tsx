"use client";

// Inline SVG chart of recent temperature readings — keeps the bundle light
// (no recharts/chartjs). Highlights the normal band 37.2 – 38.3°C and any
// out-of-band readings in amber.

type Point = { recordedAt: string; tempC: number };

export function TemperatureChart({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
        No temperature readings logged yet. Add one from the Health log section on the horse profile.
      </div>
    );
  }

  // Sort ascending for the chart line.
  const sorted = [...points].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
  const W = 600;
  const H = 220;
  const PAD = 32;

  const temps = sorted.map((p) => p.tempC);
  const minT = Math.min(36, ...temps);
  const maxT = Math.max(40, ...temps);

  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, sorted.length - 1);
  const y = (t: number) => H - PAD - ((t - minT) * (H - PAD * 2)) / Math.max(0.1, maxT - minT);

  const linePath = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.tempC).toFixed(1)}`)
    .join(" ");

  // Normal band
  const bandTop = y(38.3);
  const bandBottom = y(37.2);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[500px] w-full">
        <rect
          x={PAD}
          y={bandTop}
          width={W - PAD * 2}
          height={bandBottom - bandTop}
          fill="rgb(16 185 129 / 0.12)"
          stroke="rgb(16 185 129 / 0.4)"
          strokeDasharray="4 4"
        />
        <text x={PAD + 4} y={bandTop - 4} className="fill-emerald-700" fontSize="10">
          normal 37.2 – 38.3°C
        </text>
        <path d={linePath} fill="none" stroke="rgb(59 130 246)" strokeWidth="2" />
        {sorted.map((p, i) => {
          const out = p.tempC < 37.2 || p.tempC > 38.3;
          return (
            <g key={i}>
              <circle
                cx={x(i)}
                cy={y(p.tempC)}
                r={3}
                fill={out ? "rgb(217 119 6)" : "rgb(59 130 246)"}
              />
              {out && (
                <text x={x(i)} y={y(p.tempC) - 8} textAnchor="middle" fontSize="10" className="fill-amber-700">
                  {p.tempC.toFixed(1)}
                </text>
              )}
            </g>
          );
        })}
        {/* Y-axis labels at min, normal-band edges, max */}
        {[minT, 37.2, 38.3, maxT].map((v) => (
          <text key={v} x={4} y={y(v) + 3} fontSize="10" className="fill-muted-foreground">
            {v.toFixed(1)}
          </text>
        ))}
      </svg>
      <div className="mt-1 text-xs text-muted-foreground">
        {sorted.length} reading{sorted.length === 1 ? "" : "s"} in window · amber dots = outside normal band
      </div>
    </div>
  );
}
