"use client";

import { Badge } from "@/components/ui/badge";

interface RubricAxisLite {
  key: string;
  name?: string;
  scale?: number;
}

export function RunMetricsPanel({
  metrics,
  rubricAxes,
  isChatReplay,
}: {
  metrics: Record<string, unknown> | null;
  rubricAxes: RubricAxisLite[] | null;
  isChatReplay: boolean;
}) {
  if (!metrics || typeof metrics !== "object") {
    return (
      <p className="text-xs text-muted-foreground">
        No metrics yet — start the run and refresh once it completes.
      </p>
    );
  }
  const overall = (metrics as { overall?: Record<string, unknown> }).overall;
  const splits =
    (metrics as { splits?: Record<string, Record<string, unknown>> }).splits ?? null;

  if (!overall || typeof overall !== "object") {
    return (
      <p className="text-xs text-muted-foreground">
        No overall rollup yet — run may still be in progress.
      </p>
    );
  }

  if (!isChatReplay) {
    return <FunctionCallMetrics overall={overall as Record<string, unknown>} splits={splits} />;
  }
  return (
    <ChatReplayMetrics
      overall={overall as Record<string, unknown>}
      splits={splits}
      rubricAxes={rubricAxes}
    />
  );
}

function FunctionCallMetrics({
  overall,
  splits,
}: {
  overall: Record<string, unknown>;
  splits: Record<string, Record<string, unknown>> | null;
}) {
  const rows: Array<[string, string]> = [
    ["function_accuracy", pct(overall.function_accuracy)],
    ["parameter_accuracy", pct(overall.parameter_accuracy)],
    ["turn_level_parameter_accuracy", pct(overall.turn_level_parameter_accuracy)],
    ["argument_similarity", pct(overall.argument_similarity)],
    ["total_calls", str(overall.total_calls)],
    ["total_turns", str(overall.total_turns)],
    ["api_failed_calls", str(overall.api_failed_calls)],
  ];
  return (
    <div className="space-y-4">
      <KV rows={rows} />
      {splits && Object.keys(splits).length > 1 && (
        <details className="rounded border border-border/60 bg-muted/20">
          <summary className="cursor-pointer select-none px-2 py-1 text-xs text-muted-foreground">
            Per-split breakdown
          </summary>
          <div className="grid gap-3 p-3 sm:grid-cols-2 md:grid-cols-3">
            {Object.entries(splits).map(([name, m]) => (
              <div key={name} className="rounded-md border border-border bg-card p-2">
                <div className="mb-1 text-xs font-medium">{name}</div>
                <KV
                  rows={[
                    ["func", pct(m.function_accuracy)],
                    ["param", pct(m.parameter_accuracy)],
                    ["arg sim", pct(m.argument_similarity)],
                  ]}
                />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ChatReplayMetrics({
  overall,
  splits,
  rubricAxes,
}: {
  overall: Record<string, unknown>;
  splits: Record<string, Record<string, unknown>> | null;
  rubricAxes: RubricAxisLite[] | null;
}) {
  const verdicts =
    (overall.verdictCounts as Record<string, number> | undefined) ?? {
      pass: 0,
      warn: 0,
      fail: 0,
    };
  const axes = (overall.axes as Record<string, number | null> | undefined) ?? {};
  const validators =
    (overall.validators as
      | Record<string, { total?: number; passRate?: number; warnRate?: number; failRate?: number; meanScore?: number | null }>
      | undefined) ?? {};
  const fc = overall.functionCall as Record<string, unknown> | null | undefined;
  const totalItems =
    typeof overall.totalItems === "number"
      ? overall.totalItems
      : (verdicts.pass ?? 0) + (verdicts.warn ?? 0) + (verdicts.fail ?? 0);

  const axisOrder = rubricAxes?.map((a) => a.key) ?? Object.keys(axes);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <VerdictPill label="Pass" value={verdicts.pass ?? 0} tone="emerald" total={totalItems} />
        <VerdictPill label="Warn" value={verdicts.warn ?? 0} tone="amber" total={totalItems} />
        <VerdictPill label="Fail" value={verdicts.fail ?? 0} tone="destructive" total={totalItems} />
        {typeof overall.failedItems === "number" && overall.failedItems > 0 && (
          <VerdictPill
            label="API failed"
            value={overall.failedItems as number}
            tone="destructive"
            total={totalItems}
          />
        )}
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Rubric axes (mean %, normalised to axis scale)
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {axisOrder.map((k) => {
            const v = axes[k];
            const axisMeta = rubricAxes?.find((a) => a.key === k);
            return <AxisBar key={k} axisKey={k} name={axisMeta?.name ?? k} value={v} />;
          })}
        </div>
      </section>

      {Object.keys(validators).length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Deterministic validators
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {Object.entries(validators).map(([k, v]) => (
              <div key={k} className="rounded-md border border-border bg-card p-2">
                <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono">{k}</span>
                  <span className="text-muted-foreground">n={v.total ?? 0}</span>
                </div>
                <div className="text-xs">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {Math.round((v.passRate ?? 0) * 100)}%
                  </span>{" "}
                  pass{" · "}
                  <span className="text-amber-600 dark:text-amber-400">
                    {Math.round((v.warnRate ?? 0) * 100)}%
                  </span>{" "}
                  warn{" · "}
                  <span className="text-destructive">
                    {Math.round((v.failRate ?? 0) * 100)}%
                  </span>{" "}
                  fail
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {fc && typeof fc.function_accuracy === "number" && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Function-call accuracy
          </h3>
          <KV
            rows={[
              ["function_accuracy", pct(fc.function_accuracy)],
              ["parameter_accuracy", pct(fc.parameter_accuracy)],
              ["argument_similarity", pct(fc.argument_similarity)],
              ["total_calls", str(fc.total_calls)],
              ["api_failed_calls", str(fc.api_failed_calls)],
            ]}
          />
        </section>
      )}

      {splits && Object.keys(splits).length > 1 && (
        <details className="rounded border border-border/60 bg-muted/20">
          <summary className="cursor-pointer select-none px-2 py-1 text-xs text-muted-foreground">
            Per-language split breakdown
          </summary>
          <div className="grid gap-3 p-3 sm:grid-cols-2">
            {Object.entries(splits).map(([name, m]) => {
              const sa = (m.axes as Record<string, number | null>) ?? {};
              return (
                <div key={name} className="rounded-md border border-border bg-card p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {name}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      n={typeof m.totalItems === "number" ? m.totalItems : "?"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {axisOrder.map((k) => (
                      <AxisBar
                        key={k}
                        axisKey={k}
                        name={rubricAxes?.find((a) => a.key === k)?.name ?? k}
                        value={sa[k]}
                        compact
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function AxisBar({
  axisKey,
  name,
  value,
  compact,
}: {
  axisKey: string;
  name: string;
  value: number | null | undefined;
  compact?: boolean;
}) {
  const v = typeof value === "number" ? Math.max(0, Math.min(1, value)) : null;
  return (
    <div
      className={
        compact
          ? "flex items-center gap-2 text-[11px]"
          : "rounded-md border border-border bg-card p-2 text-xs"
      }
    >
      {!compact && (
        <div className="mb-1 flex items-center justify-between gap-2">
          <span>{name}</span>
          <code className="font-mono text-[10px] text-muted-foreground">{axisKey}</code>
        </div>
      )}
      <div
        className={
          compact
            ? "flex flex-1 items-center gap-1.5"
            : "flex items-center gap-2"
        }
      >
        {compact && (
          <span className="w-28 truncate font-mono text-[10px] text-muted-foreground">{name}</span>
        )}
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-foreground/70"
            style={{ width: v == null ? "0%" : `${v * 100}%` }}
          />
        </div>
        <span className="w-10 text-right font-mono text-[10px]">
          {v == null ? "—" : `${Math.round(v * 100)}%`}
        </span>
      </div>
    </div>
  );
}

function VerdictPill({
  label,
  value,
  tone,
  total,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "destructive";
  total: number;
}) {
  const colorClass =
    tone === "emerald"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "amber"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-destructive/40 bg-destructive/10 text-destructive";
  const pctVal = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`rounded-md border px-3 py-1.5 text-xs ${colorClass}`}>
      <span className="font-medium">{label}:</span> {value}
      {total > 0 && <span className="ml-1 opacity-70">({pctVal}%)</span>}
    </div>
  );
}

function KV({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[180px_1fr] gap-x-2 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-muted-foreground">{k}</dt>
          <dd className="font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function pct(n: unknown): string {
  return typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "—";
}
function str(n: unknown): string {
  return n == null ? "—" : String(n);
}
