"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface RunningJob {
  id: string;
  cellKey: string;
}

export function LiveJobPreview({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const [runningJobs, setRunningJobs] = useState<RunningJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasoningText, setReasoningText] = useState("");
  const [contentText, setContentText] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLPreElement | null>(null);
  const reasoningRef = useRef<HTMLPreElement | null>(null);

  // Poll for the list of currently-running jobs (cheap query, jobs change slowly).
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/runs/${runId}/running-jobs`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = (await res.json()) as { jobs: RunningJob[] };
          if (mounted) {
            setRunningJobs(data.jobs);
            // Auto-select the first running job if none is selected.
            setSelectedId((cur) => {
              if (cur && data.jobs.some((j) => j.id === cur)) return cur;
              return data.jobs[0]?.id ?? null;
            });
          }
        }
      } catch {
        // ignore polling errors
      }
      if (mounted) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, runId]);

  // Subscribe to the selected job's SSE token stream.
  useEffect(() => {
    if (!selectedId) {
      setReasoningText("");
      setContentText("");
      setInfo(null);
      setError(null);
      return;
    }
    setReasoningText("");
    setContentText("");
    setInfo("Connecting…");
    setError(null);

    const url = `/api/projects/${projectId}/runs/${runId}/jobs/${selectedId}/stream`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return;
      }
      const event = parsed.event as string;
      if (event === "open") setInfo("Streaming…");
      else if (event === "delta") {
        const text = (parsed.text as string) ?? "";
        if (parsed.reasoning) {
          setReasoningText((t) => t + text);
          queueMicrotask(() => {
            const el = reasoningRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        } else {
          setContentText((t) => t + text);
          queueMicrotask(() => {
            const el = contentRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        }
      } else if (event === "done") {
        const ti = parsed.tokens_in as number | undefined;
        const to = parsed.tokens_out as number | undefined;
        const ms = parsed.latency_ms as number | undefined;
        setInfo(
          `Done${ti != null ? ` · ${ti}/${to} tokens` : ""}${ms != null ? ` · ${ms} ms` : ""}`,
        );
      } else if (event === "error") {
        setError((parsed.error as string) || "stream error");
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };
    return () => es.close();
  }, [projectId, runId, selectedId]);

  if (runningJobs.length === 0 && !selectedId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Live job preview</span>
          <span className="text-xs font-normal text-muted-foreground">
            {info ?? `${runningJobs.length} running`}
          </span>
        </CardTitle>
        <CardDescription>
          Token stream from one currently-running job. Pick another below to switch.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {runningJobs.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {runningJobs.map((j) => (
              <Button
                key={j.id}
                type="button"
                variant={j.id === selectedId ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedId(j.id)}
                title={j.cellKey}
                className="h-7 font-mono text-[10px]"
              >
                {j.id.slice(-6)}
              </Button>
            ))}
          </div>
        )}

        {selectedId && (
          <div className="text-xs text-muted-foreground">
            <Badge variant="outline" className="mr-1 font-mono text-[10px]">
              {selectedId.slice(-6)}
            </Badge>
            {runningJobs.find((j) => j.id === selectedId)?.cellKey ?? ""}
          </div>
        )}

        {(reasoningText || contentText) && (
          <>
            {reasoningText && (
              <details open className="rounded-md border border-border bg-muted/20">
                <summary className="cursor-pointer select-none px-2 py-1 text-xs font-medium text-muted-foreground">
                  Reasoning ({reasoningText.length} chars)
                </summary>
                <pre
                  ref={reasoningRef}
                  className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2 py-2 font-mono text-[11px] italic text-muted-foreground"
                >
                  {reasoningText}
                </pre>
              </details>
            )}
            <pre
              ref={contentRef}
              className="max-h-72 min-h-[6rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-2 font-mono text-xs"
            >
              {contentText || "Waiting for first content token…"}
            </pre>
          </>
        )}

        {!reasoningText && !contentText && selectedId && (
          <p className="text-xs text-muted-foreground">
            Connected. Waiting for the first delta from job{" "}
            <span className="font-mono">{selectedId.slice(-6)}</span>…
          </p>
        )}

        {error && (
          <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
