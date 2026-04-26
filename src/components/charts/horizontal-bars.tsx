// Tiny horizontal-bar list. Used for top-N rankings.

interface Row {
  label: string;
  value: number;
  hint?: string;
}

export function HorizontalBars({
  data,
  formatValue,
  emptyText = "No data",
}: {
  data: Row[];
  formatValue?: (v: number) => string;
  emptyText?: string;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  return (
    <ul className="space-y-2">
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        return (
          <li key={d.label} className="space-y-1" title={d.hint ?? `${d.label}: ${fmt(d.value)}`}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-foreground">{d.label}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{fmt(d.value)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, pct)}%`, opacity: 0.5 + 0.5 * (d.value / max) }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
