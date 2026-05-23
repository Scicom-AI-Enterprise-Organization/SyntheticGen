"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, RefreshCw, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { restartBenchmarkRun } from "../../../actions";

export function RestartBenchmarkRunButton({
  projectId,
  runId,
  status,
  completedTurns,
  totalTurns,
}: {
  projectId: string;
  runId: string;
  status: string;
  // Drives whether the Resume button shows. We only offer Resume when
  // there's persisted partial progress — for a never-started or
  // fully-completed run, "Restart" (fresh) is the only sensible action.
  completedTurns: number;
  totalTurns: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const hasResults = ["running", "failed", "completed", "cancelled"].includes(status);
  const hasPartialProgress =
    completedTurns > 0 && completedTurns < totalTurns && status !== "completed";

  async function doRestart(mode: "fresh" | "resume") {
    setMessage(null);
    setError(null);
    if (mode === "fresh") {
      const ok = await confirm({
        title: "Restart this benchmark run from scratch?",
        body: hasResults
          ? "All per-item results for this run will be deleted and the run will be re-queued. Aggregate metrics are reset to zero. This cannot be undone."
          : "The run is currently queued — restart re-dispatches it to the worker. Nothing is lost.",
        confirmText: "Restart from scratch",
        cancelText: "Keep as-is",
        destructive: hasResults,
      });
      if (!ok) return;
    }
    start(async () => {
      const res = await restartBenchmarkRun(projectId, runId, mode);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if ("warning" in res && res.warning) {
        setMessage(res.warning);
      } else {
        setMessage(mode === "resume" ? "Resume dispatched." : "Restart dispatched.");
      }
      router.refresh();
    });
  }

  return (
    <div className="relative flex gap-2">
      {hasPartialProgress && (
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={pending}
          onClick={() => doRestart("resume")}
          title={`Re-queue this run and pick up where it stopped. Already-judged items (${completedTurns}/${totalTurns}) are preserved.`}
        >
          {pending ? (
            <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="mr-2 h-3.5 w-3.5" />
          )}
          Resume ({completedTurns}/{totalTurns})
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => doRestart("fresh")}
      >
        {pending ? (
          <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
        )}
        Restart
      </Button>
      {message && (
        <span
          className="absolute right-0 top-full mt-1 max-w-[360px] truncate text-[10px] text-muted-foreground"
          title={message}
        >
          {message}
        </span>
      )}
      {error && (
        <span
          className="absolute right-0 top-full mt-1 max-w-[360px] truncate text-[10px] text-destructive"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}
