// Tiny zero-dependency vertical-bar chart, server-rendered SVG.
// Used by dashboard for daily activity timelines.

interface DailyPoint {
  label: string; // e.g. "Mon" or "12 Apr"
  value: number;
  hint?: string;
}

interface BarChartProps {
  data: DailyPoint[];
  height?: number;
  formatValue?: (v: number) => string;
}

export function BarChart({ data, height = 120, formatValue }: BarChartProps) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">No activity yet.</p>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const isZero = d.value === 0;
          return (
            <div
              key={i}
              className="group relative flex flex-1 items-end"
              title={d.hint ?? `${d.label}: ${fmt(d.value)}`}
              style={{ height: "100%" }}
            >
              <div
                className={
                  isZero
                    ? "w-full rounded-sm bg-muted/40"
                    : "w-full rounded-sm bg-primary/20 transition-colors group-hover:bg-primary/40"
                }
                style={{ height: isZero ? "2px" : `${Math.max(2, pct)}%` }}
              >
                {!isZero && (
                  <div
                    className="h-full w-full rounded-sm bg-primary"
                    style={{ opacity: 0.6 + 0.4 * (d.value / max) }}
                  />
                )}
              </div>
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-0.5 text-[10px] text-foreground shadow-sm group-hover:block">
                {fmt(d.value)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((d, i) => (
          <div key={i} className="flex-1 truncate text-center text-[9px] text-muted-foreground">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
