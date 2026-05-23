"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, X, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TurnSlice {
  turn: number;        // 1-indexed
  candidate: string;
  judge: string;
}

interface ItemState {
  index: number;
  conversationId: string;
  split: string;
  // Multi-turn rendering. The worker emits `candidate.replay` and
  // `judge.delta` events with a `turn` field; we slot each by turn so
  // per-turn judge runs render as separate side-by-side sections
  // instead of one concatenated blob.
  turns: Map<number, TurnSlice>;
  // One-shot fallback (no turn field on events): single judge pane.
  candidateText: string;
  judgeText: string;
  judgeStarted: boolean;
  status: "running" | "succeeded" | "failed";
  verdict: "pass" | "warn" | "fail" | null;
  error: string | null;
}

function tidy(s: string): string {
  return s.replace(/\r/g, "").replace(/\n{2,}/g, "\n").trimStart();
}

// Multi-tab streaming UI for an in-flight benchmark run. Mirrors the
// conversation Live Job Preview: tiles for each in-flight item, click
// a tile to focus that item's streaming panes.
//
// The benchmark worker processes items concurrently (default 4 at a
// time), so multiple items can be streaming simultaneously. Each event
// from the SSE carries an `index` we use to demux into a per-item state
// bag.
export function LiveBenchmarkPreview({
  projectId,
  benchmarkId,
  runId,
  initialStatus,
}: {
  projectId: string;
  benchmarkId: string;
  runId: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(initialStatus);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Map<number, ItemState>>(new Map());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshedRef = useRef(false);
  const candidateScrollRef = useRef<HTMLPreElement | null>(null);
  const judgeScrollRef = useRef<HTMLPreElement | null>(null);

  // Mutate-in-place updater so we keep referential identity stable for
  // non-affected items (React only re-renders when state object identity
  // changes — we still wrap the Map in a new instance so React notices).
  function updateItem(index: number, patch: Partial<ItemState>) {
    setItems((prev) => {
      const next = new Map(prev);
      const cur = next.get(index) ?? {
        index,
        conversationId: "",
        split: "",
        turns: new Map<number, TurnSlice>(),
        candidateText: "",
        judgeText: "",
        judgeStarted: false,
        status: "running" as const,
        verdict: null,
        error: null,
      };
      next.set(index, { ...cur, ...patch });
      return next;
    });
  }

  // Update a single turn slot inside an item — used by candidate.replay
  // and judge.delta events when they carry a `turn` field. Without a
  // turn field, fall back to the legacy single-pane path.
  function updateTurn(
    itemIndex: number,
    turn: number,
    patch: Partial<TurnSlice>,
  ) {
    setItems((prev) => {
      const cur = prev.get(itemIndex);
      if (!cur) return prev;
      const nextTurns = new Map(cur.turns);
      const slice = nextTurns.get(turn) ?? {
        turn,
        candidate: "",
        judge: "",
      };
      nextTurns.set(turn, { ...slice, ...patch });
      const next = new Map(prev);
      next.set(itemIndex, { ...cur, turns: nextTurns });
      return next;
    });
  }

  useEffect(() => {
    const url = `/api/projects/${projectId}/benchmarks/${benchmarkId}/runs/${runId}/stream`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return;
      }
      const event = parsed.event as string;
      const idx =
        typeof parsed.index === "number" ? (parsed.index as number) : null;

      if (event === "open") return;
      if (event === "snapshot" || event === "run.start") {
        if (typeof parsed.status === "string") setStatus(parsed.status);
        if (typeof parsed.total === "number") setTotal(parsed.total);
        if (typeof parsed.completed === "number") setCompleted(parsed.completed);
        if (typeof parsed.failed === "number") setFailed(parsed.failed);
      } else if (event === "item.start" && idx != null) {
        const cid = typeof parsed.conversationId === "string" ? parsed.conversationId : "";
        const split = typeof parsed.split === "string" ? parsed.split : "";
        updateItem(idx, {
          conversationId: cid,
          split,
          turns: new Map<number, TurnSlice>(),
          candidateText: "",
          judgeText: "",
          judgeStarted: false,
          status: "running",
          verdict: null,
          error: null,
        });
        // Auto-focus the most recent item if user hasn't picked one yet.
        setSelectedIndex((cur) => (cur == null ? idx : cur));
      } else if (event === "candidate.replay" && idx != null) {
        const raw = typeof parsed.text === "string" ? parsed.text : "";
        const turn = typeof parsed.turn === "number" ? parsed.turn : null;
        if (turn != null && turn > 0) {
          updateTurn(idx, turn, { candidate: tidy(raw) });
        } else {
          updateItem(idx, { candidateText: tidy(raw) });
        }
      } else if (event === "judge.start" && idx != null) {
        const turn = typeof parsed.turn === "number" ? parsed.turn : null;
        if (turn != null && turn > 0) {
          // Reset just THIS turn's judge text so a fresh stream starts clean.
          updateTurn(idx, turn, { judge: "" });
          updateItem(idx, { judgeStarted: true });
        } else {
          updateItem(idx, { judgeStarted: true, judgeText: "" });
        }
      } else if (event === "judge.delta" && idx != null) {
        const t = typeof parsed.text === "string" ? parsed.text : "";
        const turn = typeof parsed.turn === "number" ? parsed.turn : null;
        if (t) {
          if (turn != null && turn > 0) {
            setItems((prev) => {
              const cur = prev.get(idx);
              if (!cur) return prev;
              const nextTurns = new Map(cur.turns);
              const slice = nextTurns.get(turn) ?? { turn, candidate: "", judge: "" };
              nextTurns.set(turn, { ...slice, judge: tidy(slice.judge + t) });
              const next = new Map(prev);
              next.set(idx, { ...cur, turns: nextTurns });
              return next;
            });
          } else {
            setItems((prev) => {
              const next = new Map(prev);
              const cur = next.get(idx);
              if (!cur) return prev;
              const merged = tidy(cur.judgeText + t);
              next.set(idx, { ...cur, judgeText: merged });
              return next;
            });
          }
        }
      } else if (event === "item.done" && idx != null) {
        const verdict = (parsed.verdict as ItemState["verdict"]) ?? null;
        const cand =
          typeof parsed.candidatePreview === "string" ? parsed.candidatePreview : null;
        const rationale =
          typeof parsed.rationalePreview === "string" ? parsed.rationalePreview : null;
        // Preserve the full streamed judge output (which includes the
        // JSON scores) — only fall back to the rationale-only preview if
        // we never saw the stream (e.g. page opened after item.done).
        setItems((prev) => {
          const next = new Map(prev);
          const cur = next.get(idx);
          if (!cur) return prev;
          next.set(idx, {
            ...cur,
            status: "succeeded",
            verdict,
            // Only overwrite candidateText if we never received the
            // candidate.replay event (cur.candidateText is empty).
            candidateText: cur.candidateText || (cand ? tidy(cand) : ""),
            // Same logic for judge: keep the streamed full JSON; only
            // backfill from rationalePreview when stream wasn't seen.
            judgeText: cur.judgeText || (rationale ? tidy(rationale) : ""),
          });
          return next;
        });
        if (typeof parsed.completed === "number") setCompleted(parsed.completed);
        if (typeof parsed.failed === "number") setFailed(parsed.failed);
        if (typeof parsed.total === "number") setTotal(parsed.total);
        // The worker writes incremental metrics after each item; nudge
        // the server-rendered Metrics panel below so it picks them up
        // without the user manually refreshing.
        router.refresh();
      } else if (event === "item.error" && idx != null) {
        const err = typeof parsed.error === "string" ? parsed.error : "unknown";
        updateItem(idx, { status: "failed", error: err });
        if (typeof parsed.completed === "number") setCompleted(parsed.completed);
        if (typeof parsed.failed === "number") setFailed(parsed.failed);
      } else if (event === "run.done") {
        if (typeof parsed.status === "string") setStatus(parsed.status);
        if (typeof parsed.completed === "number") setCompleted(parsed.completed);
        if (typeof parsed.failed === "number") setFailed(parsed.failed);
        if (typeof parsed.total === "number") setTotal(parsed.total);
        es.close();
        if (!refreshedRef.current) {
          refreshedRef.current = true;
          router.refresh();
        }
      } else if (event === "error") {
        setError((parsed.error as string) || "stream error");
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        es.close();
      }
    };
    return () => es.close();
  }, [projectId, benchmarkId, runId, router]);

  const selected = selectedIndex != null ? items.get(selectedIndex) ?? null : null;

  // Sticky-bottom on streaming panes when the focused item updates.
  useEffect(() => {
    const el = candidateScrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance <= 48) el.scrollTop = el.scrollHeight;
  }, [selected?.candidateText]);
  useEffect(() => {
    const el = judgeScrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance <= 48) el.scrollTop = el.scrollHeight;
  }, [selected?.judgeText]);

  const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
  const isLive = !["completed", "failed", "cancelled"].includes(status);
  const itemList = Array.from(items.values()).sort((a, b) => a.index - b.index);
  const runningCount = itemList.filter((it) => it.status === "running").length;
  const passes = itemList.filter((it) => it.verdict === "pass").length;
  const warns = itemList.filter((it) => it.verdict === "warn").length;
  const fails = itemList.filter((it) => it.verdict === "fail").length;

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4" />
          {isLive ? "Live progress" : "Final progress"}
          <Badge variant="outline" className="text-[10px]">
            {status}
          </Badge>
          {isLive && runningCount > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {runningCount} streaming
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {completed + failed}/{total} items {failed > 0 && `· ${failed} failed`}
          {" · "}
          {percent}%
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Tiles — one per item we've seen. Click to focus. Mirrors the
          conversation Live Job Preview's per-job tile row. */}
      {itemList.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {itemList.map((it) => {
            const isSelected = it.index === selectedIndex;
            const isRunning = it.status === "running";
            const isFailed = it.status === "failed" || it.verdict === "fail";
            return (
              <Button
                key={it.index}
                type="button"
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedIndex(it.index)}
                title={`#${it.index + 1} · ${it.conversationId.slice(-6)} · ${
                  it.error ? `error: ${it.error}` : (it.verdict ?? it.status)
                }`}
                className={cn(
                  "h-7 font-mono text-[10px]",
                  !isSelected && isFailed && "border-destructive/40 text-destructive",
                  !isSelected && it.verdict === "pass" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
                  !isSelected && it.verdict === "warn" && "border-amber-500/40 text-amber-700 dark:text-amber-300",
                  !isSelected && !isRunning && !it.verdict && "opacity-70",
                )}
              >
                {isRunning && (
                  <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                )}
                {it.error ? <AlertTriangle className="mr-1 h-3 w-3" /> : it.verdict === "pass" ? <Check className="mr-1 h-3 w-3" /> : it.verdict === "fail" ? <X className="mr-1 h-3 w-3" /> : null}
                #{it.index + 1}
                {it.conversationId && (
                  <span className="ml-1 opacity-60">
                    {it.conversationId.slice(-6)}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {(passes > 0 || warns > 0 || fails > 0) && (
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="text-emerald-600 dark:text-emerald-400">
            {passes} pass
          </span>
          <span className="text-amber-600 dark:text-amber-400">
            {warns} warn
          </span>
          <span className="text-destructive">{fails} fail</span>
        </div>
      )}

      {selected && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            Item <span className="font-mono">#{selected.index + 1}</span>
            {selected.split && (
              <> · split <span className="font-mono">{selected.split}</span></>
            )}
            {selected.conversationId && (
              <> · <span className="font-mono">{selected.conversationId.slice(-6)}</span></>
            )}
            {selected.error && (
              <> · <span className="text-destructive">{selected.error}</span></>
            )}
          </div>
        </div>
      )}

      {selected && selected.turns.size > 0 && (
        // Per-turn rendering — one row per turn so the candidate
        // reference and judge output stay paired up. Latest turn at the
        // bottom; auto-scroll is per-row via native overflow.
        <div className="space-y-3">
          {Array.from(selected.turns.values())
            .sort((a, b) => a.turn - b.turn)
            .map((tr) => (
              <div key={tr.turn} className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Turn {tr.turn}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Reference assistant turn ·{" "}
                      {tr.candidate ? `${tr.candidate.length} chars` : "no content"}
                    </div>
                    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-2 font-mono text-[11px]">
                      {tr.candidate || (
                        <span className="italic text-muted-foreground">
                          (no reference text for this turn — likely tool-call only)
                        </span>
                      )}
                    </pre>
                  </div>
                  {(tr.judge || selected.status === "running") && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>Judge output</span>
                        {tr.judge && selected.status === "running" && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 normal-case">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                            streaming · {tr.judge.length} chars
                          </span>
                        )}
                      </div>
                      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-2 font-mono text-[11px]">
                        {tr.judge ||
                          (selected.status === "running"
                            ? "waiting for first token…"
                            : "")}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* One-shot fallback (no per-turn events) — single side-by-side
          pane like before. */}
      {selected && selected.turns.size === 0 && (selected.candidateText || selected.judgeText) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {selected.candidateText && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Reference assistant turn</span>
                <span className="text-muted-foreground normal-case">
                  {selected.candidateText.length} chars
                </span>
              </div>
              <pre
                ref={candidateScrollRef}
                className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-2 font-mono text-[11px]"
              >
                {selected.candidateText}
              </pre>
            </div>
          )}
          {selected.judgeText && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Judge output</span>
                {selected.status === "running" && (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 normal-case">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    streaming · {selected.judgeText.length} chars
                  </span>
                )}
                {selected.judgeStarted && !selected.judgeText && (
                  <span className="text-muted-foreground normal-case">waiting for first token…</span>
                )}
              </div>
              <pre
                ref={judgeScrollRef}
                className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-2 font-mono text-[11px]"
              >
                {selected.judgeText}
              </pre>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
