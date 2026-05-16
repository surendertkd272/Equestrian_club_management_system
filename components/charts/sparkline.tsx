// Tiny inline SVG sparkline. Single series, no axes. Good for trendline embellishments.

export function Sparkline({
  values,
  width = 160,
  height = 40,
  stroke = "currentColor",
  fill = "transparent",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="hsl(var(--muted))" strokeDasharray="3 3" />
      </svg>
    );
  }
  if (values.length === 1) {
    // One-point series: draw a dot in the middle so the user knows it rendered.
    return (
      <svg width={width} height={height} aria-hidden="true">
        <circle cx={width / 2} cy={height / 2} r={3} fill={stroke} />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const padY = 4;
  const usableH = height - padY * 2;
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = padY + usableH - ((v - min) / range) * usableH;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={points} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
