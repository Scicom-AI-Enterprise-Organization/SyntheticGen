"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { cancelBenchmarkRun } from "../actions";

interface Run {
  id: string;
  status: string;
  model: string;
  providerName: string;
  providerKind: string;
  totalTurns: number;
  completedTurns: number;
  failedTurns: number;
  metrics: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  lastError: string | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "secondary",
  running: "default",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

function pct(n: unknown): string {
  return typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "—";
}

// Legacy rows persist BenchmarkRun.metrics as a JSON-encoded *string*
// (worker wrote without `::jsonb` cast). This helper parses defensively
// so completed runs don't render every column as "—" despite having
// real data in the DB.
function asMetricsObject(
  metrics: unknown,
): Record<string, unknown> | null {
  if (typeof metrics === "string") {
    try {
      const p = JSON.parse(metrics);
      return p && typeof p === "object" && !Array.isArray(p)
        ? (p as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (metrics && typeof metrics === "object" && !Array.isArray(metrics)) {
    return metrics as Record<string, unknown>;
  }
  return null;
}

function readOverall(metrics: Record<string, unknown> | null) {
  const m = asMetricsObject(metrics);
  if (!m) return null;
  const overall = (m as { overall?: Record<string, unknown> }).overall;
  if (!overall || typeof overall !== "object") return null;
  return overall as Record<string, unknown>;
}

// Detect chat-replay metrics by looking for the marker we write from the worker.
function isChatReplay(metrics: Record<string, unknown> | null): boolean {
  const m = asMetricsObject(metrics);
  if (!m) return false;
  return (m as { kind?: string }).kind === "chat-replay";
}

export function RunsTable({
  projectId,
  benchmarkId,
  benchmarkKind,
  canCancel,
  runs,
}: {
  projectId: string;
  benchmarkId: string;
  benchmarkKind: string;
  canCancel: boolean;
  runs: Run[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function onCancel(runId: string) {
    const ok = await confirm({
      title: "Cancel this benchmark run?",
      body: "Partial metrics from already-evaluated rows are kept.",
      confirmText: "Cancel run",
      cancelText: "Keep running",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      const res = await cancelBenchmarkRun(projectId, runId);
      if ("error" in res && (res as { error?: string }).error) {
        setError((res as { error: string }).error);
        return;
      }
      router.refresh();
    });
  }

  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No runs yet — start one above.</p>;
  }

  const isChatReplayBenchmark = benchmarkKind === "project-chat-replay";

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Started</th>
              <th className="py-2 pr-4 font-medium">Provider · Model</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Progress</th>
              {isChatReplayBenchmark ? (
                <>
                  <th className="py-2 pr-4 font-medium">Pass / Warn / Fail</th>
                  <th className="py-2 pr-4 font-medium">Top axes</th>
                  <th className="py-2 pr-4 font-medium">Validators</th>
                  <th className="py-2 pr-4 font-medium">Func acc</th>
                </>
              ) : (
                <>
                  <th className="py-2 pr-4 font-medium">Func acc</th>
                  <th className="py-2 pr-4 font-medium">Param acc</th>
                  <th className="py-2 pr-4 font-medium">Turn perfect</th>
                  <th className="py-2 pr-4 font-medium">Arg sim</th>
                </>
              )}
              <th className="py-2 pl-4" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const o = readOverall(r.metrics);
              const isLive = r.status === "queued" || r.status === "running";
              const replay = isChatReplay(r.metrics);
              return (
                <tr key={r.id} className="border-b border-border/50 align-top">
                  <td className="py-3 pr-4 text-xs text-muted-foreground">
                    {new Date(r.startedAt ?? r.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-xs">
                    <div className="font-mono">{r.model}</div>
                    <div className="text-muted-foreground">
                      {r.providerName} · {r.providerKind}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-[10px]">
                      {r.status}
                    </Badge>
                    {r.lastError && (
                      <div
                        className="mt-1 max-w-[160px] truncate text-[10px] text-destructive"
                        title={r.lastError}
                      >
                        {r.lastError}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs">
                    {r.totalTurns > 0
                      ? `${r.completedTurns}/${r.totalTurns}`
                      : isLive
                        ? "loading…"
                        : "—"}
                    {r.failedTurns > 0 && (
                      <span className="ml-1 text-destructive">({r.failedTurns} fail)</span>
                    )}
                  </td>

                  {isChatReplayBenchmark ? (
                    <ChatReplayCells overall={replay ? o : null} />
                  ) : (
                    <>
                      <td className="py-3 pr-4 font-mono text-xs">{pct(o?.function_accuracy)}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{pct(o?.parameter_accuracy)}</td>
                      <td className="py-3 pr-4 font-mono text-xs">
                        {pct(o?.turn_level_parameter_accuracy)}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">{pct(o?.argument_similarity)}</td>
                    </>
                  )}

                  <td className="py-3 pl-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/projects/${projectId}/benchmarks/${benchmarkId}/runs/${r.id}`}
                        className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                        aria-label="View run details"
                      >
                        details
                        <ChevronRight className="ml-0.5 h-3 w-3" />
                      </Link>
                      {canCancel && isLive && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={pending}
                          onClick={() => onCancel(r.id)}
                          aria-label="Cancel run"
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChatReplayCells({ overall }: { overall: Record<string, unknown> | null }) {
  if (!overall) {
    return (
      <>
        <td className="py-3 pr-4 text-xs text-muted-foreground">—</td>
        <td className="py-3 pr-4 text-xs text-muted-foreground">—</td>
        <td className="py-3 pr-4 text-xs text-muted-foreground">—</td>
        <td className="py-3 pr-4 text-xs text-muted-foreground">—</td>
      </>
    );
  }
  const verdicts = (overall.verdictCounts as Record<string, number> | undefined) ?? {};
  const axes = (overall.axes as Record<string, number | null> | undefined) ?? {};
  const validators =
    (overall.validators as Record<string, { passRate?: number; total?: number }> | undefined) ?? {};
  const fc = overall.functionCall as Record<string, unknown> | null | undefined;

  const axisEntries = Object.entries(axes)
    .filter(([, v]) => typeof v === "number")
    .sort(([, a], [, b]) => (b as number) - (a as number));
  const validatorEntries = Object.entries(validators);

  return (
    <>
      <td className="py-3 pr-4 text-xs">
        <span className="text-emerald-600 dark:text-emerald-400">{verdicts.pass ?? 0}</span>
        {" / "}
        <span className="text-amber-600 dark:text-amber-400">{verdicts.warn ?? 0}</span>
        {" / "}
        <span className="text-destructive">{verdicts.fail ?? 0}</span>
      </td>
      <td className="py-3 pr-4 text-[11px]">
        <div className="space-y-0.5">
          {axisEntries.slice(0, 3).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="font-mono text-muted-foreground">{k}</span>
              <span className="font-mono">{((v as number) * 100).toFixed(0)}%</span>
            </div>
          ))}
          {axisEntries.length > 3 && (
            <div className="text-[10px] text-muted-foreground">+{axisEntries.length - 3} more</div>
          )}
        </div>
      </td>
      <td className="py-3 pr-4 text-[11px]">
        <div className="space-y-0.5">
          {validatorEntries.slice(0, 3).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="font-mono text-muted-foreground">{k}</span>
              <span className="font-mono">
                {typeof v.passRate === "number" ? `${(v.passRate * 100).toFixed(0)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      </td>
      <td className="py-3 pr-4 font-mono text-xs">
        {fc ? pct((fc as { function_accuracy?: number }).function_accuracy) : "—"}
      </td>
    </>
  );
}
