// Server-rendered SVG donut. Uses theme `--chart-N` tokens.

interface DonutSegment {
  label: string;
  value: number;
  /** CSS variable name minus the leading `--`, e.g. "chart-1". Defaults rotate. */
  colorVar?: string;
}

interface DonutChartProps {
  data: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerHint?: string;
}

const DEFAULT_COLOR_VARS = ["chart-3", "chart-1", "chart-2", "chart-4", "chart-5"];

export function DonutChart({
  data,
  size = 140,
  thickness = 22,
  centerLabel,
  centerHint,
}: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2;
  const inner = r - thickness;
  const cx = r;
  const cy = r;

  if (total === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height: size }}>
        <span className="text-xs text-muted-foreground">No data</span>
      </div>
    );
  }

  let startAngle = -Math.PI / 2; // start at 12 o'clock
  const arcs = data.map((d, i) => {
    const frac = d.value / total;
    const endAngle = startAngle + frac * 2 * Math.PI;
    const a0 = startAngle;
    const a1 = endAngle;
    startAngle = endAngle;
    return { d, a0, a1, i };
  });

  function arcPath(a0: number, a1: number) {
    // Avoid drawing a degenerate sweep when a single segment owns 100%.
    const span = Math.min(a1 - a0, 2 * Math.PI - 1e-4);
    const aa = a0 + span;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(aa);
    const y1 = cy + r * Math.sin(aa);
    const xi0 = cx + inner * Math.cos(aa);
    const yi0 = cy + inner * Math.sin(aa);
    const xi1 = cx + inner * Math.cos(a0);
    const yi1 = cy + inner * Math.sin(a0);
    const largeArc = span > Math.PI ? 1 : 0;
    return [
      `M ${x0} ${y0}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`,
      `L ${xi0} ${yi0}`,
      `A ${inner} ${inner} 0 ${largeArc} 0 ${xi1} ${yi1}`,
      "Z",
    ].join(" ");
  }

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map(({ d, a0, a1, i }) => (
          <path
            key={i}
            d={arcPath(a0, a1)}
            fill={`var(--${d.colorVar ?? DEFAULT_COLOR_VARS[i % DEFAULT_COLOR_VARS.length]})`}
          >
            <title>{`${d.label}: ${d.value.toLocaleString()} (${Math.round((d.value / total) * 100)}%)`}</title>
          </path>
        ))}
        {centerLabel && (
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-foreground"
            fontSize="20"
            fontWeight="600"
          >
            {centerLabel}
          </text>
        )}
        {centerHint && (
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            fontSize="9"
          >
            {centerHint}
          </text>
        )}
      </svg>
      <ul className="flex-1 space-y-1 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{
                  backgroundColor: `var(--${d.colorVar ?? DEFAULT_COLOR_VARS[i % DEFAULT_COLOR_VARS.length]})`,
                }}
              />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {d.value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
