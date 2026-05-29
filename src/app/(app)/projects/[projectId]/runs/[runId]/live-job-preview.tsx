"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Play, RefreshCw, Square, User, Bot, Wrench, FlaskConical, ArrowRight, Copy, Check, FileCode } from "lucide-react";
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
// One visited flow node — collects everything that happens at this node
// (streamed content + reasoning, mock tool calls and their synthetic
// responses, branch decision, end-node outcome). One card per node in the
// timeline, rendered in visit order.
type FlowNodeToolCall = {
  name: string;
  args: string;        // accumulated arguments fragments (or full JSON args)
  resultPreview: string;
  resultStream: string; // streaming text from _mock_tool_result
  done: boolean;
};
type FlowNodeBlock = {
  kind: "flow_node";
  nodeId: string;
  nodeKind: string | null;   // "start" / "intent" / "action" / "condition" / "end"
  label: string | null;
  content: string;            // streaming assistant content
  reasoning: string;          // streaming <think> block
  userText: string;           // for intent nodes (the synthetic user utterance)
  toolCalls: FlowNodeToolCall[];
  branchChose: string | null; // for condition nodes
  branchOptions: string[];
  outcome: string | null;     // for end nodes
  finalChars: number | null;  // final assistant content char count (after done)
  active: boolean;            // true while running, flipped to false on flow.step
};

type FlowGraphNode = {
  id: string;
  type: string | null;
  label: string | null;
  description?: string | null;
  position?: { x: number; y: number } | null;
  outcome?: string | null;
};
type FlowGraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string | null;
};

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
  | { kind: "tool_result"; name: string; preview: string }
  | {
      // The exact request sent to the user-simulator LLM to PRODUCE the
      // following user turn. Renders as a collapsible "before this user turn"
      // card so reviewers can audit the prompt that drove the simulation.
      //
      // `responseReasoning` / `responseContent` accumulate `simulator.delta`
      // SSE events that arrive AFTER this block — so the simulator's
      // chain-of-thought + final user utterance materialize inside the same
      // card. This makes the path "prompt → reasoning → output → user turn"
      // visible top-to-bottom.
      kind: "simulator_request";
      purpose: string;
      model: string;
      temperature: number | null;
      maxTokens: number | null;
      system: string;
      userMsg: string;
      systemChars: number;
      truncated: boolean;
      responseReasoning: string;
      responseContent: string;
    }
  | FlowNodeBlock;

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
  const [flowGraph, setFlowGraph] = useState<{
    name: string | null;
    nodes: FlowGraphNode[];
    edges: FlowGraphEdge[];
    visited: string[];           // node ids visited so far, in traversal order
    branchPick: Record<string, string>; // condition-node id → chosen edge label
  } | null>(null);
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
    setFlowGraph(null);
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
              // Prefer a still-active (running/queued/pending) job over a
              // terminal one for auto-select so a freshly-restarted job
              // (now queued) gets picked up by the live preview.
              const active = data.jobs.find(
                (j) => !j.status || j.status === "running" || j.status === "queued" || j.status === "pending",
              );
              return active?.id ?? data.jobs[0]?.id ?? null;
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
    setFlowGraph(null);
      setInfo(null);
      setError(null);
      setStreamBroken(false);
      setStreamStartedAt(null);
      setStreamRunning(false);
      doneSeenRef.current = false;
      return;
    }
    setBlocks([]);
    setFlowGraph(null);
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
      } else if (event === "simulator.request") {
        // Renders BEFORE the user_turn block it produced. Lets reviewers see
        // the exact prompt the user-simulator LLM was given (persona, register,
        // tool catalog, hard rules) for this specific job, so awkward openings
        // can be traced back to the prompt rather than the model.
        const purpose = (parsed.purpose as string) || "";
        const model = (parsed.model as string) || "";
        const temperature =
          typeof parsed.temperature === "number"
            ? (parsed.temperature as number)
            : null;
        const maxTokens =
          typeof parsed.max_tokens === "number"
            ? (parsed.max_tokens as number)
            : null;
        const system = (parsed.system as string) || "";
        const userMsg = (parsed.user_msg as string) || "";
        const systemChars =
          typeof parsed.system_chars === "number"
            ? (parsed.system_chars as number)
            : system.length;
        const truncated = Boolean(parsed.truncated);
        setBlocks((prev) => [
          ...prev,
          {
            kind: "simulator_request",
            purpose,
            model,
            temperature,
            maxTokens,
            system,
            userMsg,
            systemChars,
            truncated,
            responseReasoning: "",
            responseContent: "",
          },
        ]);
      } else if (event === "simulator.delta") {
        // Append to the response section of the MOST RECENT simulator_request
        // block. Deltas arrive between the `simulator.request` event and the
        // `turn.user` event that follows, so "most recent" is unambiguous.
        const text = (parsed.text as string) ?? "";
        if (!text) return;
        const reasoning = Boolean(parsed.reasoning);
        setBlocks((prev) => appendSimulatorDelta(prev, text, reasoning));
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
      } else if (event === "flow.graph") {
        // Full graph definition arrives once per job. Some code paths emit
        // it more than once (JobEvent replay AND cache replay both send
        // their own copy), so preserve any `visited` / `branchPick`
        // accumulated from prior flow.node.start events rather than
        // resetting them — otherwise a second flow.graph wipes the green
        // fill off every already-visited node.
        const nodes = Array.isArray(parsed.nodes) ? (parsed.nodes as FlowGraphNode[]) : [];
        const edges = Array.isArray(parsed.edges) ? (parsed.edges as FlowGraphEdge[]) : [];
        setFlowGraph((prev) => ({
          name: (parsed.name as string) || null,
          nodes,
          edges,
          visited: prev?.visited ?? [],
          branchPick: prev?.branchPick ?? {},
        }));
      } else if (event === "flow.node.start") {
        const nodeId = (parsed.node as string) || "";
        const nodeKind = (parsed.kind as string) || null;
        const label = (parsed.label as string) || null;
        // Append visit ALWAYS — even if the graph hasn't arrived yet, we
        // create a stub graph holding just the visited array so the
        // upcoming flow.graph can merge against it instead of clobbering.
        // Old code returned the null graph unchanged ("if g then update,
        // else skip"), which dropped early visits when events arrived
        // out of order.
        setFlowGraph((g) => {
          if (!g) {
            return {
              name: null,
              nodes: [],
              edges: [],
              visited: [nodeId],
              branchPick: {},
            };
          }
          return {
            ...g,
            visited: g.visited.includes(nodeId) ? g.visited : [...g.visited, nodeId],
          };
        });
        setBlocks((prev) => [
          ...prev,
          {
            kind: "flow_node",
            nodeId,
            nodeKind,
            label,
            content: "",
            reasoning: "",
            userText: "",
            toolCalls: [],
            branchChose: null,
            branchOptions: [],
            outcome: null,
            finalChars: null,
            active: true,
          },
        ]);
      } else if (event === "flow.delta") {
        const text = (parsed.text as string) ?? "";
        if (!text) return;
        const reasoning = Boolean(parsed.reasoning);
        const nodeId = (parsed.node as string) || "";
        setBlocks((prev) => appendFlowDelta(prev, nodeId, text, reasoning));
      } else if (event === "flow.tool_call.frag") {
        const name = (parsed.name as string) || "";
        const frag = (parsed.fragment as string) || "";
        const nodeId = (parsed.node as string) || "";
        setBlocks((prev) => appendFlowToolFrag(prev, nodeId, name, frag));
      } else if (event === "flow.tool.mock.start") {
        // The synthetic backend is about to render the mock response.
        // No-op visually for now; reserved for a "thinking…" indicator.
        // The streamed content arrives via flow.tool.mock.delta below.
      } else if (event === "flow.tool.mock.delta") {
        const text = (parsed.text as string) ?? "";
        if (!text) return;
        const reasoning = Boolean(parsed.reasoning);
        const nodeId = (parsed.node as string) || "";
        const tool = (parsed.tool as string) || "";
        setBlocks((prev) => appendFlowToolDelta(prev, nodeId, tool, text, reasoning));
      } else if (event === "flow.tool.result") {
        const name = (parsed.name as string) || "";
        const preview = (parsed.preview as string) || "";
        const nodeId = (parsed.node as string) || "";
        setBlocks((prev) => completeFlowToolResult(prev, nodeId, name, preview));
      } else if (event === "flow.step") {
        // Node finished — flip the latest flow_node block's `active` flag
        // off and capture per-kind metadata (userText for intent, branch
        // pick for condition, outcome for end, char count for action).
        const nodeId = (parsed.node as string) || "";
        const stepKind = (parsed.kind as string) || "";
        const userText = (parsed.userText as string) || "";
        const chosenLabel = (parsed.chosenLabel as string) || null;
        const options = Array.isArray(parsed.options) ? (parsed.options as string[]) : [];
        const outcome = (parsed.outcome as string) || null;
        const finalChars = typeof parsed.finalContentChars === "number" ? (parsed.finalContentChars as number) : null;
        if (chosenLabel && nodeId) {
          setFlowGraph((g) => (g ? { ...g, branchPick: { ...g.branchPick, [nodeId]: chosenLabel } } : g));
        }
        setBlocks((prev) => closeFlowNode(prev, nodeId, {
          stepKind,
          userText,
          chosenLabel,
          options,
          outcome,
          finalChars,
        }));
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
          // EventSource gave up reconnecting. Flip streamRunning off so the
          // throughput badge stops ticking — otherwise it ticks forever
          // because we never received a `done` event to clear it.
          setStreamRunning(false);
          es.close();
        }
      }
    };
    return () => {
      // Component-unmount / job-switch cleanup. Stop the badge too in
      // case we never saw `done` (e.g. user switched away mid-stream or
      // the run finished while the page was hidden).
      setStreamRunning(false);
      es.close();
    };
  }, [projectId, runId, selectedId, subscribeNonce]);

  // (Previously had a scroll listener that maintained a `userScrolledUpRef`
  // flag here. The auto-scroll path now measures distance-from-bottom at
  // the moment a new token lands, which is race-free without the flag.)

  if (runningJobs.length === 0 && !selectedId) {
    return null;
  }

  const selectedCellKey =
    runningJobs.find((j) => j.id === selectedId)?.cellKey ?? "";

  // "Still active" = running OR queued OR pending. Restarted jobs land in
  // `queued` until a worker picks them up; without including them here
  // the badge header read "0 running" even though a job WAS in flight.
  const runningCount = runningJobs.filter(
    (j) => !j.status || j.status === "running" || j.status === "queued" || j.status === "pending",
  ).length;

  // Sum every text-bearing block so the throughput badge sees the same chars
  // the user is watching scroll past. Cheap because there aren't many blocks
  // per job.
  const streamedText = blocks
    .map((b) => {
      if (b.kind === "text") return b.text;
      if (b.kind === "user_turn") return b.text;
      if (b.kind === "tool_call") return b.args;
      if (b.kind === "tool_result") return b.preview;
      if (b.kind === "simulator_request")
        return b.responseReasoning + b.responseContent;
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
              // `queued` / `pending` are also "live" from the user's POV —
              // the api-executor path runs the job without flipping DB
              // status off `queued`, so the green pulse stayed dark for
              // jobs that were actively producing flow.step events.
              const isRunning =
                !j.status ||
                j.status === "running" ||
                j.status === "queued" ||
                j.status === "pending";
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
            {flowGraph && (
              <FlowGraphView
                graph={flowGraph}
                activeNodeId={
                  // Latest flow_node block that's still active (running)
                  // gets highlighted in the DAG so reviewers see exactly
                  // where execution is right now.
                  (() => {
                    for (let i = blocks.length - 1; i >= 0; i--) {
                      const b = blocks[i];
                      if (b.kind === "flow_node" && b.active) return b.nodeId;
                    }
                    return null;
                  })()
                }
              />
            )}
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
      case "simulator_request": {
        const header = `[USER-SIMULATOR REQUEST · ${b.purpose}] model=${b.model}` +
          (b.temperature != null ? ` temp=${b.temperature}` : "") +
          (b.maxTokens != null ? ` max_tokens=${b.maxTokens}` : "") +
          (b.truncated ? ` (system truncated, full length=${b.systemChars})` : "");
        const tail: string[] = [
          `${header}\n--- system ---\n${tidy(b.system)}\n--- user ---\n${tidy(b.userMsg)}`,
        ];
        const respReasoning = tidy(b.responseReasoning);
        if (respReasoning) tail.push(`--- simulator reasoning ---\n${respReasoning}`);
        const respContent = tidy(b.responseContent);
        if (respContent) tail.push(`--- simulator output ---\n${respContent}`);
        parts.push(tail.join("\n"));
        break;
      }
      case "flow_node": {
        const head = `[FLOW · ${b.nodeKind ?? "?"} · ${b.label ?? b.nodeId}]`;
        const lines: string[] = [head];
        if (b.userText) lines.push(`(simulated user) ${tidy(b.userText)}`);
        const reasoning = tidy(b.reasoning);
        if (reasoning) lines.push(`--- reasoning ---\n${reasoning}`);
        const content = tidy(b.content);
        if (content) lines.push(content);
        for (const tc of b.toolCalls) {
          lines.push(`[TOOL CALL ${tc.done ? "✓" : "…"}] ${tc.name}(${tc.args || "{}"})`);
          const stream = tidy(tc.resultStream);
          if (stream) lines.push(`--- tool result stream ---\n${stream}`);
          if (tc.resultPreview) lines.push(`[result] ${tidy(tc.resultPreview)}`);
        }
        if (b.branchChose) lines.push(`→ branch chose "${b.branchChose}" of [${b.branchOptions.join(", ")}]`);
        if (b.outcome) lines.push(`(outcome: ${b.outcome})`);
        parts.push(lines.join("\n"));
        break;
      }
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

function appendSimulatorDelta(
  prev: Block[],
  text: string,
  reasoning: boolean,
): Block[] {
  for (let i = prev.length - 1; i >= 0; i--) {
    const b = prev[i];
    if (b.kind === "simulator_request") {
      const next = [...prev];
      next[i] = reasoning
        ? { ...b, responseReasoning: b.responseReasoning + text }
        : { ...b, responseContent: b.responseContent + text };
      return next;
    }
  }
  // Delta arrived without a preceding `simulator.request` (shouldn't happen,
  // but defensive). Drop it rather than guessing where to attach.
  return prev;
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

// ─── flow_node block helpers ────────────────────────────────────────────────
// Each flow.delta / flow.tool.* event targets the most recent flow_node block
// for the matching nodeId. We search from the tail because the same nodeId
// can be revisited (loops in the flow), and the latest visit owns the deltas.

function findLatestFlowNode(prev: Block[], nodeId: string): number {
  for (let i = prev.length - 1; i >= 0; i--) {
    const b = prev[i];
    if (b.kind === "flow_node" && b.nodeId === nodeId) return i;
  }
  return -1;
}

function appendFlowDelta(
  prev: Block[],
  nodeId: string,
  text: string,
  reasoning: boolean,
): Block[] {
  const i = findLatestFlowNode(prev, nodeId);
  if (i < 0) return prev;
  const b = prev[i] as FlowNodeBlock;
  const next = [...prev];
  next[i] = reasoning
    ? { ...b, reasoning: b.reasoning + text }
    : { ...b, content: b.content + text };
  return next;
}

function appendFlowToolFrag(
  prev: Block[],
  nodeId: string,
  name: string,
  frag: string,
): Block[] {
  const i = findLatestFlowNode(prev, nodeId);
  if (i < 0) return prev;
  const b = prev[i] as FlowNodeBlock;
  const tools = [...b.toolCalls];
  // Reuse the last incomplete tool_call with the same name, else append.
  let target = -1;
  for (let j = tools.length - 1; j >= 0; j--) {
    if (tools[j].name === name && !tools[j].done) {
      target = j;
      break;
    }
  }
  if (target < 0) {
    tools.push({ name, args: frag, resultPreview: "", resultStream: "", done: false });
  } else {
    tools[target] = { ...tools[target], args: tools[target].args + frag };
  }
  const next = [...prev];
  next[i] = { ...b, toolCalls: tools };
  return next;
}

function appendFlowToolDelta(
  prev: Block[],
  nodeId: string,
  toolName: string,
  text: string,
  reasoning: boolean,
): Block[] {
  // Streaming text from the synthetic mock-backend LLM that produces the
  // tool's JSON response. Tagged with reasoning so the UI could style it
  // differently; for now we just append both to the same stream buffer.
  void reasoning;
  const i = findLatestFlowNode(prev, nodeId);
  if (i < 0) return prev;
  const b = prev[i] as FlowNodeBlock;
  const tools = [...b.toolCalls];
  let target = -1;
  for (let j = tools.length - 1; j >= 0; j--) {
    if (tools[j].name === toolName) {
      target = j;
      break;
    }
  }
  if (target < 0) {
    tools.push({ name: toolName, args: "", resultPreview: "", resultStream: text, done: false });
  } else {
    tools[target] = { ...tools[target], resultStream: tools[target].resultStream + text };
  }
  const next = [...prev];
  next[i] = { ...b, toolCalls: tools };
  return next;
}

function completeFlowToolResult(
  prev: Block[],
  nodeId: string,
  toolName: string,
  preview: string,
): Block[] {
  const i = findLatestFlowNode(prev, nodeId);
  if (i < 0) return prev;
  const b = prev[i] as FlowNodeBlock;
  const tools = [...b.toolCalls];
  let target = -1;
  for (let j = tools.length - 1; j >= 0; j--) {
    if (tools[j].name === toolName && !tools[j].done) {
      target = j;
      break;
    }
  }
  if (target < 0) {
    tools.push({ name: toolName, args: "", resultPreview: preview, resultStream: "", done: true });
  } else {
    tools[target] = { ...tools[target], resultPreview: preview, done: true };
  }
  const next = [...prev];
  next[i] = { ...b, toolCalls: tools };
  return next;
}

function closeFlowNode(
  prev: Block[],
  nodeId: string,
  patch: {
    stepKind: string;
    userText: string;
    chosenLabel: string | null;
    options: string[];
    outcome: string | null;
    finalChars: number | null;
  },
): Block[] {
  const i = findLatestFlowNode(prev, nodeId);
  if (i < 0) return prev;
  const b = prev[i] as FlowNodeBlock;
  const next = [...prev];
  next[i] = {
    ...b,
    active: false,
    userText: patch.userText || b.userText,
    branchChose: patch.chosenLabel ?? b.branchChose,
    branchOptions: patch.options.length ? patch.options : b.branchOptions,
    outcome: patch.outcome ?? b.outcome,
    finalChars: patch.finalChars ?? b.finalChars,
  };
  return next;
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

    case "simulator_request": {
      const respReasoning = tidy(block.responseReasoning);
      const respContent = tidy(block.responseContent);
      const hasResponse = Boolean(respReasoning || respContent);
      return (
        // Default-open so the simulator's reasoning/output is visible while
        // it's streaming — the user explicitly asked to see this. Reviewers
        // can collapse it after the fact via the same <details> element.
        <details
          open
          className="rounded-md border border-slate-500/40 bg-slate-500/5"
        >
          <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <FileCode className="h-3 w-3" />
              User-simulator request
              <code className="font-mono normal-case text-muted-foreground">
                · {block.purpose}
              </code>
              <span className="font-normal normal-case text-muted-foreground">
                ·{" "}
                <code className="font-mono">{block.model}</code>
                {block.temperature != null && (
                  <> · temp {block.temperature}</>
                )}
                {block.maxTokens != null && (
                  <> · max_tokens {block.maxTokens}</>
                )}
                {block.truncated && (
                  <> · system clipped ({block.systemChars.toLocaleString()} chars total)</>
                )}
              </span>
            </span>
          </summary>
          <div className="space-y-2 border-t border-slate-500/30 p-2">
            {/* Request: nested <details> so the (long) system prompt is
                collapsed by default and doesn't bury the streaming response. */}
            <details className="rounded-md border border-muted-foreground/20 bg-background/40">
              <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                request · system + user
              </summary>
              <div className="space-y-2 p-2 pt-0">
                <div>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    system
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 px-2 py-1.5 font-mono text-[11px]">
                    {block.system}
                    {block.truncated && (
                      <span className="text-muted-foreground">
                        {"\n\n…[truncated for SSE — full prompt in JobEvent timeline]"}
                      </span>
                    )}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    user
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 px-2 py-1.5 font-mono text-[11px]">
                    {block.userMsg}
                  </pre>
                </div>
              </div>
            </details>

            {/* Response: streamed deltas. Reasoning first (if model emits any),
                then the final user-turn text the simulator wrote. Empty until
                the first delta arrives. */}
            {hasResponse ? (
              <div className="space-y-2">
                {respReasoning && (
                  <div>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      simulator reasoning · {respReasoning.length} chars
                    </div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 px-2 py-1.5 font-mono text-[11px] italic text-muted-foreground">
                      {respReasoning}
                    </pre>
                  </div>
                )}
                {respContent && (
                  <div>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      simulator output
                    </div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px]">
                      {respContent}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[10px] italic text-muted-foreground">
                Waiting for simulator response…
              </p>
            )}
          </div>
        </details>
      );
    }

    case "flow_node": {
      const kindColors: Record<string, { border: string; bg: string; text: string }> = {
        start:             { border: "border-slate-500/40",   bg: "bg-slate-500/5",   text: "text-slate-700 dark:text-slate-300" },
        intent:            { border: "border-blue-500/40",    bg: "bg-blue-500/5",    text: "text-blue-700 dark:text-blue-300" },
        action:            { border: "border-emerald-500/40", bg: "bg-emerald-500/5", text: "text-emerald-700 dark:text-emerald-300" },
        condition:         { border: "border-amber-500/40",   bg: "bg-amber-500/5",   text: "text-amber-700 dark:text-amber-300" },
        end:               { border: "border-rose-500/40",    bg: "bg-rose-500/5",    text: "text-rose-700 dark:text-rose-300" },
        bridge_user:       { border: "border-blue-500/30",    bg: "bg-blue-500/5",    text: "text-blue-700 dark:text-blue-300" },
        bridge_assistant:  { border: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-700 dark:text-emerald-300" },
      };
      const c = kindColors[block.nodeKind ?? ""] ?? kindColors.start;
      const reasoning = tidy(block.reasoning);
      // For condition nodes, the streamed `content` is just the picker's
      // bare integer answer (e.g. "3"). The user-meaningful info is the
      // chosen branch label rendered below, so suppress the integer to
      // keep the card readable. Reasoning (why it picked that branch) is
      // still shown.
      const content = block.nodeKind === "condition" ? "" : tidy(block.content);
      return (
        <div className={`rounded-md border ${c.border} ${c.bg} p-2`}>
          <div className={`mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide ${c.text}`}>
            <span className="inline-flex items-center gap-1.5">
              <ArrowRight className="h-3 w-3" />
              flow · {block.nodeKind ?? "?"}
              <span className="font-mono normal-case text-muted-foreground">
                · {block.label ?? block.nodeId}
              </span>
            </span>
            {block.active && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] normal-case text-muted-foreground">
                running…
              </span>
            )}
          </div>
          {block.userText && (
            <div className="mb-1 rounded border border-blue-500/30 bg-blue-500/5 px-2 py-1 text-[11px]">
              <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">simulated user</div>
              <div className="whitespace-pre-wrap break-words">{tidy(block.userText)}</div>
            </div>
          )}
          {reasoning && (
            <details className="mb-1 rounded-md border border-muted-foreground/20 bg-background/60">
              <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                reasoning · {reasoning.length} chars
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-muted-foreground/20 px-2 py-1.5 font-mono text-[11px] italic text-muted-foreground">
                {reasoning}
              </pre>
            </details>
          )}
          {content && (
            <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px]">
              {content}
            </pre>
          )}
          {block.toolCalls.map((tc, i) => (
            <div key={i} className="mt-1 rounded-md border border-purple-500/30 bg-purple-500/5 p-1.5">
              <div className="mb-1 flex items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
                <span>{tc.done ? "✓" : "…"} tool · {tc.name}</span>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
                {tc.args || "{}"}
              </pre>
              {tc.resultStream && (
                <details className="mt-1 rounded border border-muted-foreground/20 bg-background/40">
                  <summary className="cursor-pointer select-none px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    mock backend output · {tc.resultStream.length} chars
                  </summary>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-muted-foreground/20 px-2 py-1.5 font-mono text-[10px]">
                    {tc.resultStream}
                  </pre>
                </details>
              )}
              {tc.resultPreview && (
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background px-1.5 py-1 font-mono text-[10px]">
                  {tc.resultPreview}
                </pre>
              )}
            </div>
          ))}
          {block.branchChose && (
            <div className="mt-1 text-[11px]">
              <span className="text-muted-foreground">→ chose </span>
              <code className="font-mono font-semibold">{block.branchChose}</code>
              {block.branchOptions.length > 1 && (
                <span className="text-muted-foreground"> of [{block.branchOptions.join(", ")}]</span>
              )}
            </div>
          )}
          {block.outcome && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              outcome: <code className="font-mono">{block.outcome}</code>
            </div>
          )}
        </div>
      );
    }
  }
}

// ─── Flow DAG visualization ──────────────────────────────────────────────────
// Compact SVG view of the flow's nodes + edges. Uses the worker-provided
// `position.x/y` from the Flow's authored layout so the graph matches what
// the user sees in the flow editor. Visited nodes get filled, the active
// node pulses, and the edges along the traversed path are emphasized.

function FlowGraphView({
  graph,
  activeNodeId,
}: {
  graph: {
    name: string | null;
    nodes: FlowGraphNode[];
    edges: FlowGraphEdge[];
    visited: string[];
    branchPick: Record<string, string>;
  };
  activeNodeId: string | null;
}) {
  // Compute bounds from authored positions; fall back to a grid layout when
  // positions are missing (very old flows or hand-rolled DAGs).
  const nodeCount = graph.nodes.length;
  if (nodeCount === 0) return null;
  const NODE_W = 140;
  const NODE_H = 38;
  const PAD = 16;
  const haveAllPositions = graph.nodes.every((n) => n.position && typeof n.position.x === "number");
  const positioned = haveAllPositions
    ? graph.nodes.map((n) => ({ ...n, _x: n.position!.x, _y: n.position!.y }))
    : graph.nodes.map((n, i) => ({ ...n, _x: (i % 4) * 200, _y: Math.floor(i / 4) * 100 }));
  const minX = Math.min(...positioned.map((n) => n._x));
  const minY = Math.min(...positioned.map((n) => n._y));
  const maxX = Math.max(...positioned.map((n) => n._x + NODE_W));
  const maxY = Math.max(...positioned.map((n) => n._y + NODE_H));
  // Scale down the editor coordinates so the whole graph fits in the card.
  const rawW = Math.max(1, maxX - minX);
  const rawH = Math.max(1, maxY - minY);
  const TARGET_W = 740;
  const scale = Math.min(1, TARGET_W / rawW);
  const W = Math.ceil(rawW * scale + 2 * PAD);
  const H = Math.ceil(rawH * scale + 2 * PAD);
  const pos = (n: { _x: number; _y: number }) => ({
    x: (n._x - minX) * scale + PAD,
    y: (n._y - minY) * scale + PAD,
  });

  const visitedSet = new Set(graph.visited);
  // Build set of traversed edge ids: each visited source → next visited node
  // along the traversed sequence, picking the labeled edge if a branch
  // decision is recorded.
  const traversedEdges = new Set<string>();
  for (let i = 0; i < graph.visited.length - 1; i++) {
    const src = graph.visited[i];
    const tgt = graph.visited[i + 1];
    const edge = graph.edges.find((e) => e.source === src && e.target === tgt);
    if (edge) traversedEdges.add(edge.id);
  }

  const nodeById = new Map(positioned.map((n) => [n.id, n] as const));
  const kindFill: Record<string, string> = {
    start: "#64748b",
    intent: "#3b82f6",
    action: "#10b981",
    condition: "#f59e0b",
    end: "#f43f5e",
  };

  return (
    <div className="space-y-1 rounded-md border border-border bg-background/40 p-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">
          flow{graph.name ? ` · ${graph.name}` : ""}
        </span>
        <span>
          {graph.visited.length} / {graph.nodes.length} nodes visited
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        style={{ maxHeight: 280 }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
          <marker id="arrowOn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#10b981" />
          </marker>
        </defs>
        {graph.edges.map((e) => {
          const s = nodeById.get(e.source);
          const t = nodeById.get(e.target);
          if (!s || !t) return null;
          const a = pos(s);
          const b = pos(t);
          const x1 = a.x + (NODE_W * scale) / 2;
          const y1 = a.y + (NODE_H * scale) / 2;
          const x2 = b.x + (NODE_W * scale) / 2;
          const y2 = b.y + (NODE_H * scale) / 2;
          const on = traversedEdges.has(e.id);
          return (
            <g key={e.id} className={on ? "text-emerald-500" : "text-muted-foreground/50"}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="currentColor"
                strokeWidth={on ? 1.8 : 1}
                markerEnd={`url(#${on ? "arrowOn" : "arrow"})`}
              />
              {e.label && (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 4}
                  textAnchor="middle"
                  fontSize="9"
                  className={on ? "fill-emerald-600 dark:fill-emerald-400" : "fill-muted-foreground"}
                >
                  {e.label}
                </text>
              )}
            </g>
          );
        })}
        {positioned.map((n) => {
          const p = pos(n);
          const visited = visitedSet.has(n.id);
          const isActive = n.id === activeNodeId;
          const stroke = kindFill[n.type ?? ""] ?? "#64748b";
          // Active node uses a white fill + black text so the running
          // step pops against the rest of the graph. Visited (done)
          // nodes keep the solid kind-color fill with white text.
          // Unvisited nodes stay outline-only.
          const fill = isActive
            ? "#ffffff"
            : visited
              ? (kindFill[n.type ?? ""] ?? "#64748b")
              : "#ffffff00";
          const textFill = isActive
            ? "#000000"
            : visited
              ? "#ffffff"
              : "currentColor";
          return (
            <g key={n.id}>
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W * scale}
                height={NODE_H * scale}
                rx={6}
                fill={fill}
                stroke={stroke}
                strokeWidth={isActive ? 3 : 1.2}
                opacity={visited || isActive ? 1 : 0.55}
              >
                {isActive && (
                  <animate
                    attributeName="stroke-opacity"
                    values="1;0.4;1"
                    dur="1.2s"
                    repeatCount="indefinite"
                  />
                )}
              </rect>
              <text
                x={p.x + (NODE_W * scale) / 2}
                y={p.y + (NODE_H * scale) / 2 + 3}
                textAnchor="middle"
                fontSize="9"
                fontWeight={isActive ? 700 : 500}
                fill={textFill}
                className={visited || isActive ? "" : "fill-foreground/70"}
              >
                {(n.label ?? n.id).slice(0, 24)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
