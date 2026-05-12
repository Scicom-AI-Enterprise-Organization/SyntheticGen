"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";

interface RegenResult {
  ok?: boolean;
  eligible?: number;
  deleted?: number;
  dispatched?: number;
  message?: string;
  error?: string;
  failures?: Array<{ jobId: string; error: string }>;
}

export function RegenRunButton({
  projectId,
  runId,
  totalJobs,
  succeededJobs,
}: {
  projectId: string;
  runId: string;
  // Total jobs in this run — used purely for the label and the confirm copy.
  totalJobs: number;
  // How many of those already have a conversation (will be deleted).
  succeededJobs: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const confirm = useConfirm();

  async function onClick() {
    setError(null);
    setInfo(null);
    const ok = await confirm({
      title: `Regenerate ${totalJobs} job${totalJobs === 1 ? "" : "s"}?`,
      body:
        succeededJobs > 0
          ? `This will delete ${succeededJobs} existing conversation${succeededJobs === 1 ? "" : "s"} from this run and re-execute every job from scratch. Validators, messages, and per-conversation settings snapshots are removed too. This cannot be undone.`
          : `This will reset every job (including any in-flight ones) and dispatch them again.`,
      confirmText: "Regenerate all",
      cancelText: "Keep as-is",
      destructive: succeededJobs > 0,
    });
    if (!ok) return;

    start(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/runs/${runId}/regenerate`, {
          method: "POST",
        });
        const body = (await res.json().catch(() => ({}))) as RegenResult;
        if (!res.ok) {
          setError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const dispatched = body.dispatched ?? 0;
        const eligible = body.eligible ?? 0;
        const deleted = body.deleted ?? 0;
        const failures = body.failures ?? [];
        if (eligible === 0) {
          setInfo("Nothing to regenerate — this run has no jobs.");
        } else if (failures.length > 0) {
          setInfo(
            `Deleted ${deleted} old conversation${deleted === 1 ? "" : "s"}, re-dispatched ${dispatched}/${eligible}. ${failures.length} worker dispatch failure${failures.length === 1 ? "" : "s"} (see console).`,
          );
          // eslint-disable-next-line no-console
          console.warn("[regenerate-run] dispatch failures", failures);
        } else {
          setInfo(
            `Deleted ${deleted} old conversation${deleted === 1 ? "" : "s"}, re-dispatched ${dispatched} job${dispatched === 1 ? "" : "s"}.`,
          );
        }
        router.refresh();
      } catch (e) {
        setError((e as Error).message ?? "request failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant={succeededJobs > 0 ? "outline" : "default"}
        disabled={pending || totalJobs === 0}
        onClick={onClick}
        title={
          totalJobs === 0
            ? "No jobs to regenerate"
            : succeededJobs > 0
              ? `Delete ${succeededJobs} existing conversation${succeededJobs === 1 ? "" : "s"} and re-execute every job (${totalJobs}) from scratch`
              : `Reset and re-dispatch every job in this run (${totalJobs})`
        }
      >
        {pending ? (
          <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
        )}
        Regenerate
        {totalJobs > 0 && (
          <span className="ml-1 text-[10px] opacity-80">({totalJobs})</span>
        )}
      </Button>
      {info && (
        <span className="max-w-[320px] truncate text-[10px] text-muted-foreground" title={info}>
          {info}
        </span>
      )}
      {error && (
        <span className="max-w-[320px] truncate text-[10px] text-destructive" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
