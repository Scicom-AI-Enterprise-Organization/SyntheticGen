"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban } from "lucide-react";
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

function readOverall(metrics: Record<string, unknown> | null) {
  if (!metrics || typeof metrics !== "object") return null;
  const overall = (metrics as { overall?: Record<string, unknown> }).overall;
  if (!overall || typeof overall !== "object") return null;
  return overall as Record<string, unknown>;
}

export function RunsTable({
  projectId,
  benchmarkId,
  canCancel,
  runs,
}: {
  projectId: string;
  benchmarkId: string;
  canCancel: boolean;
  runs: Run[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
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
    start(async () => {
      const res = await cancelBenchmarkRun(projectId, runId);
      if ("error" in res && (res as { error?: string }).error)
        toast.error((res as { error: string }).error);
      else {
        toast.success("Cancelled");
        router.refresh();
      }
    });
  }

  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No runs yet — start one above.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Started</th>
            <th className="py-2 pr-4 font-medium">Provider · Model</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Progress</th>
            <th className="py-2 pr-4 font-medium">Func acc</th>
            <th className="py-2 pr-4 font-medium">Param acc</th>
            <th className="py-2 pr-4 font-medium">Turn perfect</th>
            <th className="py-2 pr-4 font-medium">Arg sim</th>
            <th className="py-2 pl-4" />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const o = readOverall(r.metrics);
            const isLive = r.status === "queued" || r.status === "running";
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
                <td className="py-3 pr-4 font-mono text-xs">{pct(o?.function_accuracy)}</td>
                <td className="py-3 pr-4 font-mono text-xs">{pct(o?.parameter_accuracy)}</td>
                <td className="py-3 pr-4 font-mono text-xs">{pct(o?.turn_level_parameter_accuracy)}</td>
                <td className="py-3 pr-4 font-mono text-xs">{pct(o?.argument_similarity)}</td>
                <td className="py-3 pl-4 text-right">
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
