"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function JumpstartJobButton({
  projectId,
  runId,
  jobId,
  status,
  attempts,
  iconOnly = false,
}: {
  projectId: string;
  runId: string;
  jobId: string;
  status: string;
  attempts: number;
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isFailed = status === "failed" || status === "cancelled";
  const isRetry = attempts > 0;
  const label = isFailed ? (isRetry ? "Jumpstart" : "Run") : "Re-run";
  const titleText = isFailed
    ? "Reset to queued and re-dispatch this job (errors clear, attempts increase)"
    : status === "succeeded"
      ? "Re-run this job — overwrites the existing conversation"
      : "Re-dispatch this job";

  function onClick() {
    setError(null);
    start(async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/runs/${runId}/jobs/${jobId}/restart`,
          { method: "POST" },
        );
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        router.refresh();
      } catch (e) {
        setError((e as Error).message ?? "request failed");
      }
    });
  }

  if (iconOnly) {
    return (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={pending}
        onClick={onClick}
        aria-label={label}
        title={error ? `${titleText} — last try: ${error}` : titleText}
        className={error ? "text-destructive" : undefined}
      >
        {pending ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : isFailed ? (
          <Play className="h-4 w-4" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
      </Button>
    );
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant={isFailed ? "default" : "outline"}
        disabled={pending}
        onClick={onClick}
        className="h-7 text-[11px]"
        title={titleText}
      >
        {pending ? (
          <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
        ) : isFailed ? (
          <Play className="mr-1 h-3 w-3" />
        ) : (
          <RefreshCw className="mr-1 h-3 w-3" />
        )}
        {label}
      </Button>
      {error && (
        <span className="max-w-[160px] truncate text-[10px] text-destructive" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
