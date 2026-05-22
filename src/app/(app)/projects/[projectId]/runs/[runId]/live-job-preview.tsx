"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Play, RefreshCw, Square, User, Bot, Wrench, FlaskConical, ArrowRight, Copy, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThroughputBadge } from "@/components/throughput-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RunningJob {
  id: string;
  cellKey: string;
  // Set when the running-jobs API includes terminal jobs so the preview can
  // replay them. Undefined for legacy callers.
  status?: string;
}

// One row in the live preview. The worker emits structured pg_notify events
// (turn.user, tool.call.*, tool.result, …) and the client appends them as
// distinct visual blocks — far easier to read than the old text-with-labels
// stream.
type Block =
  | { kind: "text"; reasoning: boolean; text: string }
  | { kind: "user_turn"; turn: number | null; text: string }
  | { kind: "assistant_turn"; turn: number | null }
  | { kind: "followup" }
  | {
      kind: "tool_call";
      index: number;
      name: string;
      args: string;
      complete: boolean;
    }
  | { kind: "tool_mock_start"; name: string }
  | { kind: "tool_result"; name: string; preview: string };

export function LiveJobPreview({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const [runningJobs, setRunningJobs] = useState<RunningJob[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previewJobParam = searchParams.get("previewJob");
  const [selectedId, setSelectedId] = useState<string | null>(previewJobParam);

  // When the URL `previewJob` param changes (user clicked a different row's
  // preview button), override the current selection so the SSE re-subscribes
  // to the new job. Keeps the URL as the single source of truth for which
  // job is showing.
  useEffect(() => {
    if (previewJobParam && previewJobParam !== selectedId) {
      setSelectedId(previewJobParam);
    }
    // selectedId is intentionally NOT in deps — we only react to URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewJobParam]);

  // Selecting a job from inside the card (tile buttons) should ALSO update
  // the URL so back-button works and the state is shareable. scroll:false
  // keeps the viewport where the user clicked.
  const selectJob = useCallback(
    (jobId: string) => {
      const next = new URLSearchParams(Array.from(searchParams.entries()));
      next.set("previewJob", jobId);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      setSelectedId(jobId);
    },
    [pathname, router, searchParams],
  );
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  // Stamp the start of a job stream so we can show a live tokens-per-second
  // chip in the header. Cleared whenever we switch jobs or the stream ends.
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  const [streamRunning, setStreamRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamBroken, setStreamBroken] = useState(false);
  const doneSeenRef = useRef(false);
  const [subscribeNonce, setSubscribeNonce] = useState(0);
  const [restarting, start] = useTransition();
  const [stopping, startStop] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyTranscript = useCallback(async () => {
    const text = blocksToText(blocks);
    if (!text.trim()) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-https / older browsers — create a hidden textarea
        // and use execCommand. Best-effort; modern dev tooling rarely hits this.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard might be blocked by permissions
    }
  }, [blocks]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const stopJob = useCallback(
    (jobId: string) => {
      setError(null);
      startStop(async () => {
        try {
          const res = await fetch(
            `/api/projects/${projectId}/runs/${runId}/jobs/${jobId}/cancel`,
            { method: "POST" },
          );
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(
              (body as { error?: string }).error ?? `stop failed: HTTP ${res.status}`,
            );
            return;
          }
          setInfo("Stopped — job marked cancelled.");
          doneSeenRef.current = true;
        } catch (e) {
          setError(`stop failed: ${(e as Error).message ?? "unknown"}`);
        }
      });
    },
    [projectId, runId],
  );

  const restartJob = useCallback(
    (jobId: string) => {
      setError(null);
      start(async () => {
        try {
          const res = await fetch(
            `/api/projects/${projectId}/runs/${runId}/jobs/${jobId}/restart`,
            { method: "POST" },
          );
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(
              (body as { error?: string }).error ?? `restart failed: HTTP ${res.status}`,
            );
            return;
          }
          setBlocks([]);
          setStreamBroken(false);
          doneSeenRef.current = false;
          setInfo("Restart dispatched — reconnecting…");
          setSubscribeNonce((n) => n + 1);
        } catch (e) {
          setError(`restart failed: ${(e as Error).message ?? "unknown"}`);
        }
      });
    },
    [projectId, runId],
  );

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
            setSelectedId((cur) => {
              // If the URL explicitly asks for a job, honor that even if it
              // isn't in the polled list (the SSE replay endpoint loads the
              // saved tokens directly from the Message rows).
              if (previewJobParam) return previewJobParam;
              if (cur && data.jobs.some((j) => j.id === cur)) return cur;
              // Prefer a still-running job over a terminal one for auto-select.
              const running = data.jobs.find((j) => !j.status || j.status === "running");
              return running?.id ?? data.jobs[0]?.id ?? null;
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
    // previewJobParam is read inside `tick` so we want the polling effect to
    // re-create when it changes — otherwise the captured closure ignores URL
    // changes until the next 3s tick.
  }, [projectId, runId, previewJobParam]);

  // Subscribe to the selected job's SSE token stream.
  useEffect(() => {
    if (!selectedId) {
      setBlocks([]);
      setInfo(null);
      setError(null);
      setStreamBroken(false);
      setStreamStartedAt(null);
      setStreamRunning(false);
      doneSeenRef.current = false;
      return;
    }
    setBlocks([]);
    setInfo("Connecting…");
    setError(null);
    setStreamBroken(false);
    setStreamStartedAt(Date.now());
    setStreamRunning(true);
    doneSeenRef.current = false;

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
      if (event === "open") setInfo("Connected · waiting for worker…");
      else if (event === "status") {
        const status = parsed.status as string | undefined;
        if (status === "running") setInfo("Streaming…");
        else if (status === "pending" || status === "queued") setInfo(`Waiting (${status})…`);
        else if (status) setInfo(`Status: ${status}`);
      } else if (event === "delta") {
        const text = (parsed.text as string) ?? "";
        if (!text) return;
        const reasoning = Boolean(parsed.reasoning);
        setBlocks((prev) => appendText(prev, text, reasoning));
      } else if (event === "turn.user") {
        const text = (parsed.text as string) ?? "";
        const turn = typeof parsed.turn === "number" ? (parsed.turn as number) : null;
        setBlocks((prev) => [...prev, { kind: "user_turn", turn, text }]);
      } else if (event === "turn.assistant") {
        const turn = typeof parsed.turn === "number" ? (parsed.turn as number) : null;
        setBlocks((prev) => [...prev, { kind: "assistant_turn", turn }]);
      } else if (event === "turn.followup") {
        setBlocks((prev) => [...prev, { kind: "followup" }]);
      } else if (event === "tool.call.frag") {
        const idx = typeof parsed.index === "number" ? (parsed.index as number) : 0;
        const name = (parsed.name as string) || "";
        const frag = (parsed.fragment as string) || "";
        setBlocks((prev) => upsertToolCall(prev, idx, name, frag));
      } else if (event === "tool.call.complete") {
        const idx = typeof parsed.index === "number" ? (parsed.index as number) : 0;
        setBlocks((prev) => completeToolCall(prev, idx));
      } else if (event === "tool.mock.start") {
        const name = (parsed.name as string) || "";
        setBlocks((prev) => [...prev, { kind: "tool_mock_start", name }]);
      } else if (event === "tool.result") {
        const name = (parsed.name as string) || "";
        const preview = (parsed.preview as string) || "";
        setBlocks((prev) => [...prev, { kind: "tool_result", name, preview }]);
      } else if (event === "done") {
        doneSeenRef.current = true;
        setStreamRunning(false);
        const ti = parsed.tokens_in as number | undefined;
        const to = parsed.tokens_out as number | undefined;
        const ms = parsed.latency_ms as number | undefined;
        const status = parsed.status as string | undefined;
        const reason = parsed.reason as string | undefined;
        const lastError = parsed.lastError as string | undefined;
        const tokenSummary = ti != null ? ` · ${ti}/${to} tokens` : "";
        const timeSummary = ms != null ? ` · ${ms} ms` : "";
        const statusSummary = status ? ` · ${status}` : "";
        setInfo(`Done${statusSummary}${tokenSummary}${timeSummary}`);
        if (reason === "status-poll" && (status === "failed" || lastError)) {
          setError(lastError || `Job ended in ${status} without streaming a done event.`);
          setStreamBroken(true);
        }
        // CRITICAL: explicitly close the EventSource so the browser doesn't
        // auto-reconnect after the server-side shutdown. Without this, the
        // server's replay loop re-fires on each reconnect and the same
        // user/assistant turns get appended over and over.
        es.close();
      } else if (event === "error") {
        setError((parsed.error as string) || "stream error");
        setStreamBroken(true);
      }
      // Sticky-to-bottom: snap to the bottom ONLY if the user is currently
      // near the bottom. Reading the live scrollTop here (instead of relying
      // on a debounced "user scrolled up" flag) is the only way to avoid
      // racing with the scroll listener — the listener is passive + async,
      // so a token arriving mid-scroll-up otherwise snapped the user back
      // to the bottom before the flag could update.
      queueMicrotask(() => {
        const el = scrollRef.current;
        if (!el) return;
        // The new content WILL grow scrollHeight after this microtask
        // returns, so we measure distance from the bottom BEFORE that
        // happens — anything within ~64px of the bottom counts as "still
        // following" and gets snapped. More than that means the user has
        // intentionally scrolled away and we leave them alone.
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distance <= 64) {
          el.scrollTop = el.scrollHeight;
        }
      });
    };
    es.onerror = () => {
      if (!doneSeenRef.current) {
        setStreamBroken(true);
        if (es.readyState === EventSource.CLOSED) {
          es.close();
        }
      }
    };
    return () => es.close();
  }, [projectId, runId, selectedId, subscribeNonce]);

  // (Previously had a scroll listener that maintained a `userScrolledUpRef`
  // flag here. The auto-scroll path now measures distance-from-bottom at
  // the moment a new token lands, which is race-free without the flag.)

  if (runningJobs.length === 0 && !selectedId) {
    return null;
  }

  const selectedCellKey =
    runningJobs.find((j) => j.id === selectedId)?.cellKey ?? "";

  const runningCount = runningJobs.filter((j) => !j.status || j.status === "running").length;

  // Sum every text-bearing block so the throughput badge sees the same chars
  // the user is watching scroll past. Cheap because there aren't many blocks
  // per job.
  const streamedText = blocks
    .map((b) => {
      if (b.kind === "text") return b.text;
      if (b.kind === "user_turn") return b.text;
      if (b.kind === "tool_call") return b.args;
      if (b.kind === "tool_result") return b.preview;
      return "";
    })
    .join("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span>Live job preview</span>
            <ThroughputBadge
              text={streamedText}
              startedAt={streamStartedAt}
              running={streamRunning}
            />
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {info ?? `${runningCount} running · ${runningJobs.length - runningCount} past`}
          </span>
        </CardTitle>
        <CardDescription>
          Token stream from one currently-running job, or saved tokens replayed
          for a past job. Click any tile below to switch.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {runningJobs.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {runningJobs.map((j) => {
              const isRunning = !j.status || j.status === "running";
              const isFailed = j.status === "failed" || j.status === "cancelled";
              const isSelected = j.id === selectedId;
              return (
                <Button
                  key={j.id}
                  type="button"
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => selectJob(j.id)}
                  title={`${j.cellKey} · ${j.status ?? "running"}`}
                  className={cn(
                    "h-7 font-mono text-[10px]",
                    !isSelected && isFailed && "border-destructive/40 text-destructive",
                    !isSelected && !isRunning && !isFailed && "opacity-70",
                  )}
                >
                  {isRunning && (
                    <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  )}
                  {j.id.slice(-6)}
                </Button>
              );
            })}
          </div>
        )}

        {selectedId && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="min-w-0 truncate">
              <Badge variant="outline" className="mr-1 font-mono text-[10px]">
                {selectedId.slice(-6)}
              </Badge>
              {selectedCellKey}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!doneSeenRef.current && !streamBroken && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={stopping}
                  onClick={() => stopJob(selectedId)}
                  className="h-7 text-[10px]"
                  title="Mark this job cancelled and close the live stream. Note: the worker can't interrupt an in-flight LLM call — its result may still land before the cancel takes effect."
                >
                  {stopping ? (
                    <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Square className="mr-1 h-3 w-3" />
                  )}
                  Stop
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={streamBroken ? "default" : "outline"}
                disabled={restarting}
                onClick={() => restartJob(selectedId)}
                className="h-7 text-[10px]"
                title="Reset the job to queued and ask the worker to execute it again"
              >
                {restarting ? (
                  <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                ) : streamBroken ? (
                  <Play className="mr-1 h-3 w-3" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                {streamBroken ? "Jumpstart job" : "Restart job"}
              </Button>
            </div>
          </div>
        )}

        {streamBroken && !doneSeenRef.current && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
            Stream terminated before the job reported <code>done</code>. The worker may
            have crashed, the job may be stuck, or the SSE proxy timed out. Click{" "}
            <strong>Jumpstart job</strong> to reset it to <code>queued</code> and re-dispatch.
          </p>
        )}

        {blocks.length === 0 && selectedId && streamRunning && (
          <p className="text-xs text-muted-foreground">
            Connected. Waiting for the first event from job{" "}
            <span className="font-mono">{selectedId.slice(-6)}</span>…
          </p>
        )}
        {blocks.length === 0 && selectedId && !streamRunning && !error && (
          <p className="text-xs text-muted-foreground">
            No streamed events were captured for job{" "}
            <span className="font-mono">{selectedId.slice(-6)}</span>. The job
            ended before producing any content.
          </p>
        )}

        {blocks.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>
                {blocks.length} block{blocks.length === 1 ? "" : "s"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={copyTranscript}
                className="h-6 px-2 text-[10px]"
                aria-label="Copy transcript"
                title="Copy the visible transcript as plain text"
              >
                {copied ? (
                  <>
                    <Check className="mr-1 h-3 w-3 text-emerald-500" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-3 w-3" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <div
              ref={scrollRef}
              className="max-h-[28rem] space-y-2 overflow-y-auto rounded-md border border-border bg-muted/20 p-2 text-xs"
            >
              {blocks.map((b, i) => (
                <BlockView key={i} block={b} />
              ))}
            </div>
          </>
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

// ─── Block reducer helpers ───────────────────────────────────────────────────

// Trim chunk edges and collapse any run of blank lines to a single newline.
// LLMs frequently emit leading/trailing `\n\n` and double-newline paragraph
// breaks; rendering them raw inside `whitespace-pre-wrap` shows up as visible
// blank rows in the UI and 3-4 blank lines in the copied transcript. We
// normalize both surfaces through this helper.
function tidy(s: string): string {
  return s.replace(/\r/g, "").replace(/\n{2,}/g, "\n").trim();
}

// Flatten the structured blocks into a plain-text transcript suitable for
// clipboard. Mirrors the way the visual blocks read top-to-bottom so a user
// pasting into a note app or bug report gets the same flow they see on screen.
function blocksToText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "text": {
        const text = tidy(b.text);
        if (!text) break;
        parts.push(b.reasoning ? `[reasoning] ${text}` : text);
        break;
      }
      case "user_turn":
        parts.push(`[USER · turn ${b.turn ?? "?"}]\n${tidy(b.text)}`);
        break;
      case "assistant_turn":
        parts.push(`[ASSISTANT · turn ${b.turn ?? "?"}]`);
        break;
      case "followup":
        parts.push("[ASSISTANT · follow-up]");
        break;
      case "tool_call":
        parts.push(
          `[TOOL CALL ${b.complete ? "✓" : "…"}] ${b.name}(${b.args || "{}"})`,
        );
        break;
      case "tool_mock_start":
        parts.push(`[mocking tool ${b.name}…]`);
        break;
      case "tool_result":
        parts.push(
          `[TOOL RESULT${b.name ? ` · ${b.name}` : ""}]\n${tidy(b.preview)}`,
        );
        break;
    }
  }
  // Single blank line between blocks; trim leading/trailing whitespace.
  return parts.filter(Boolean).join("\n\n").trim();
}


function appendText(prev: Block[], text: string, reasoning: boolean): Block[] {
  const last = prev[prev.length - 1];
  if (last && last.kind === "text" && last.reasoning === reasoning) {
    return [...prev.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...prev, { kind: "text", reasoning, text }];
}

function upsertToolCall(
  prev: Block[],
  index: number,
  name: string,
  fragment: string,
): Block[] {
  // Find the most recent incomplete tool_call with this index.
  for (let i = prev.length - 1; i >= 0; i--) {
    const b = prev[i];
    if (b.kind === "tool_call" && b.index === index && !b.complete) {
      const next = [...prev];
      next[i] = {
        ...b,
        name: name || b.name,
        args: b.args + fragment,
      };
      return next;
    }
  }
  return [
    ...prev,
    { kind: "tool_call", index, name, args: fragment, complete: false },
  ];
}

function completeToolCall(prev: Block[], index: number): Block[] {
  for (let i = prev.length - 1; i >= 0; i--) {
    const b = prev[i];
    if (b.kind === "tool_call" && b.index === index && !b.complete) {
      const next = [...prev];
      next[i] = { ...b, complete: true };
      return next;
    }
  }
  return prev;
}

// ─── Block view ──────────────────────────────────────────────────────────────

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "text": {
      const text = tidy(block.text);
      if (!text) return null;
      if (block.reasoning) {
        return (
          <details
            open
            className="rounded-md border border-muted-foreground/20 bg-background/60"
          >
            <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              reasoning · {text.length} chars
            </summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-muted-foreground/20 px-2 py-1.5 font-mono text-[11px] italic text-muted-foreground">
              {text}
            </pre>
          </details>
        );
      }
      return (
        <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px]">
          {text}
        </pre>
      );
    }

    case "user_turn":
      return (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
            <User className="h-3 w-3" />
            User{block.turn != null && <span>· turn {block.turn}</span>}
          </div>
          <div className="whitespace-pre-wrap break-words text-[11px]">
            {tidy(block.text)}
          </div>
        </div>
      );

    case "assistant_turn":
      return (
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          <Bot className="h-3 w-3" />
          Assistant{block.turn != null && <span>· turn {block.turn}</span>}
        </div>
      );

    case "followup":
      return (
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <ArrowRight className="h-3 w-3" />
          Follow-up after tools
        </div>
      );

    case "tool_call":
      return (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            <Wrench className="h-3 w-3" />
            Tool call · <code className="font-mono normal-case">{block.name || "…"}</code>
            {!block.complete && (
              <span className="text-muted-foreground">streaming…</span>
            )}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
            {block.args || "{}"}
          </pre>
        </div>
      );

    case "tool_mock_start":
      return (
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-fuchsia-700 dark:text-fuchsia-300">
          <FlaskConical className="h-3 w-3 animate-pulse" />
          Mock backend · <code className="font-mono normal-case">{block.name}</code>
          <span className="text-muted-foreground">generating result…</span>
        </div>
      );

    case "tool_result":
      return (
        <div className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/5 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-700 dark:text-fuchsia-300">
            <FlaskConical className="h-3 w-3" />
            Tool result · <code className="font-mono normal-case">{block.name}</code>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
            {tidy(block.preview)}
          </pre>
        </div>
      );
  }
}
