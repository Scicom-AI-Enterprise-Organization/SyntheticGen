"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ResultRow {
  id: string;
  kind: string;
  split: string;
  rowIdx: number;
  turnNum: number;
  conversationId: string | null;
  judgeVerdict: string | null;
  judgeRationale: string | null;
  judgeScores: Record<string, number> | null;
  validatorScores: Record<string, unknown> | null;
  functionCallScore: unknown[] | null;
  referenceMessages: unknown[] | null;
  candidateMessages: unknown[] | null;
  // Function-call-only:
  expected: unknown[] | null;
  predicted: unknown[] | null;
  resultType: string | null;
  funcMatch: boolean | null;
  paramAccuracy: number | null;
  similarity: number | null;
  apiFailed: boolean;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

interface RubricAxisLite {
  key: string;
  name?: string;
  scale?: number;
}

const VERDICT_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pass: "default",
  warn: "secondary",
  fail: "destructive",
};
const ALL = "__all__";

export function ResultsTable({
  projectId,
  results,
  rubricAxes,
  isChatReplay,
}: {
  projectId: string;
  results: ResultRow[];
  rubricAxes: RubricAxisLite[] | null;
  isChatReplay: boolean;
}) {
  const [verdict, setVerdict] = useState<string>(ALL);
  const [split, setSplit] = useState<string>(ALL);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const splits = useMemo(
    () => Array.from(new Set(results.map((r) => r.split))).sort(),
    [results],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return results.filter((r) => {
      if (verdict !== ALL && r.judgeVerdict !== verdict) return false;
      if (split !== ALL && r.split !== split) return false;
      if (!needle) return true;
      // Search rationale + conversation id + reference/candidate content.
      if (r.judgeRationale?.toLowerCase().includes(needle)) return true;
      if (r.conversationId?.toLowerCase().includes(needle)) return true;
      const blob = JSON.stringify(r.referenceMessages ?? "")
        + JSON.stringify(r.candidateMessages ?? "");
      return blob.toLowerCase().includes(needle);
    });
  }, [results, verdict, split, q]);

  // Pagination: per-turn benchmarks can produce hundreds of rows per
  // run, so paginate after filtering. Reset to first page whenever
  // filter / search / page-size changes so the user doesn't end up on
  // an empty page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filtered, safePage, pageSize],
  );
  // When filters change, jump back to page 0.
  useEffect(() => {
    setPage(0);
  }, [verdict, split, q, pageSize]);

  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No per-item results yet. They&apos;ll appear as the worker processes each conversation.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={verdict} onValueChange={setVerdict}>
          <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
            <SelectValue placeholder="All verdicts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All verdicts</SelectItem>
            <SelectItem value="pass">pass</SelectItem>
            <SelectItem value="warn">warn</SelectItem>
            <SelectItem value="fail">fail</SelectItem>
          </SelectContent>
        </Select>
        {splits.length > 1 && (
          <Select value={split} onValueChange={setSplit}>
            <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
              <SelectValue placeholder="All splits" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All splits</SelectItem>
              {splits.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search rationale / content"
          className="h-8! max-w-sm text-xs"
        />
        <span className="ml-auto text-[11px] text-muted-foreground">
          {filtered.length} of {results.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="w-6 py-2" />
              <th className="py-2 pr-4 font-medium">#</th>
              <th className="py-2 pr-4 font-medium">Split</th>
              <th className="py-2 pr-4 font-medium">Verdict</th>
              {isChatReplay && rubricAxes && (
                <th className="py-2 pr-4 font-medium">Axes (raw)</th>
              )}
              {!isChatReplay && (
                <>
                  <th className="py-2 pr-4 font-medium">Func</th>
                  <th className="py-2 pr-4 font-medium">Param</th>
                  <th className="py-2 pr-4 font-medium">Sim</th>
                </>
              )}
              <th className="py-2 pr-4 font-medium">Tokens</th>
              <th className="py-2 pr-4 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const isOpen = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    className="cursor-pointer border-b border-border/50 align-top hover:bg-muted/30"
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                  >
                    <td className="py-3 pl-1">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-[11px]">
                      {r.rowIdx}
                      {r.turnNum > 0 && (
                        <span className="text-muted-foreground">·t{r.turnNum}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs">{r.split}</td>
                    <td className="py-3 pr-4">
                      {r.apiFailed ? (
                        <Badge variant="destructive" className="text-[10px]">
                          api-failed
                        </Badge>
                      ) : r.judgeVerdict ? (
                        <Badge
                          variant={VERDICT_VARIANT[r.judgeVerdict] ?? "outline"}
                          className="text-[10px]"
                        >
                          {r.judgeVerdict}
                        </Badge>
                      ) : r.funcMatch != null ? (
                        <Badge
                          variant={r.funcMatch ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {r.funcMatch ? "match" : r.resultType ?? "miss"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    {isChatReplay && rubricAxes && (() => {
                      // Defensive parse — same reason as elsewhere in
                      // this file: older rows have judgeScores stored as
                      // a JSON-encoded string. Without this, every axis
                      // renders "—" even when the judge gave real scores.
                      let scores: Record<string, number> | null = null;
                      const raw = r.judgeScores as unknown;
                      if (typeof raw === "string") {
                        try {
                          const parsed = JSON.parse(raw);
                          if (
                            parsed &&
                            typeof parsed === "object" &&
                            !Array.isArray(parsed)
                          ) {
                            scores = parsed as Record<string, number>;
                          }
                        } catch {
                          scores = null;
                        }
                      } else if (
                        raw &&
                        typeof raw === "object" &&
                        !Array.isArray(raw)
                      ) {
                        scores = raw as Record<string, number>;
                      }
                      return (
                      <td className="py-3 pr-4 text-[11px]">
                        <div className="flex flex-wrap gap-1">
                          {rubricAxes.map((a) => {
                            const s = scores?.[a.key];
                            const scale = a.scale ?? 5;
                            return (
                              <span
                                key={a.key}
                                className="rounded border border-border/60 bg-muted/40 px-1 font-mono text-[10px]"
                                title={a.name ?? a.key}
                              >
                                {a.key}: {typeof s === "number" ? `${s}/${scale}` : "—"}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      );
                    })()}
                    {!isChatReplay && (
                      <>
                        <td className="py-3 pr-4 font-mono text-[11px]">
                          {r.funcMatch ? "✓" : "✗"}
                        </td>
                        <td className="py-3 pr-4 font-mono text-[11px]">
                          {typeof r.paramAccuracy === "number"
                            ? `${(r.paramAccuracy * 100).toFixed(0)}%`
                            : "—"}
                        </td>
                        <td className="py-3 pr-4 font-mono text-[11px]">
                          {typeof r.similarity === "number"
                            ? r.similarity.toFixed(2)
                            : "—"}
                        </td>
                      </>
                    )}
                    <td className="py-3 pr-4 font-mono text-[11px]">
                      {r.tokensIn.toLocaleString()}/{r.tokensOut.toLocaleString()}
                    </td>
                    <td className="py-3 pr-4 font-mono text-[11px]">
                      {r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : "—"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/50 bg-muted/10">
                      <td colSpan={isChatReplay ? 8 : 9} className="px-2 py-3">
                        <ResultDrilldown
                          projectId={projectId}
                          row={r}
                          rubricAxes={rubricAxes}
                          isChatReplay={isChatReplay}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing{" "}
            <span className="font-mono">
              {safePage * pageSize + 1}–
              {Math.min((safePage + 1) * pageSize, filtered.length)}
            </span>{" "}
            of <span className="font-mono">{filtered.length}</span>
          </span>
          <div className="flex items-center gap-1">
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(Number(v))}
            >
              <SelectTrigger size="sm" className="h-7 w-[90px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 / page</SelectItem>
                <SelectItem value="25">25 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="rounded border border-border bg-card px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-1 font-mono">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              disabled={safePage >= pageCount - 1}
              className="rounded border border-border bg-card px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultDrilldown({
  projectId,
  row,
  rubricAxes,
  isChatReplay,
}: {
  projectId: string;
  row: ResultRow;
  rubricAxes: RubricAxisLite[] | null;
  isChatReplay: boolean;
}) {
  if (!isChatReplay) {
    return (
      <div className="space-y-2 text-xs">
        <div>
          <h4 className="mb-1 font-medium">Expected tool_calls</h4>
          <Pre value={row.expected} />
        </div>
        <div>
          <h4 className="mb-1 font-medium">Predicted tool_calls</h4>
          <Pre value={row.predicted} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Per-turn aligned view: when the rationale has the worker's
          "— next turn —" delimiter, render a unified table where each
          row pairs that turn's assistant content with that turn's
          rationale — both cells share the row height, so the reviewer
          can scan turn 1 ↔ turn 1, turn 2 ↔ turn 2 left-to-right. */}
      {(row.candidateMessages || row.judgeRationale) && (() => {
        const parts = (row.judgeRationale ?? "")
          .split(/\n*— next turn —\n*/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        // Parse candidateMessages defensively (legacy rows may store as
        // JSON-encoded string). Walk assistant-role messages to pair
        // each one with its corresponding rationale by index.
        const rawMsgs = row.candidateMessages ?? row.referenceMessages;
        let msgs: unknown[] | null = null;
        if (typeof rawMsgs === "string") {
          try {
            const p = JSON.parse(rawMsgs);
            if (Array.isArray(p)) msgs = p;
          } catch {
            msgs = null;
          }
        } else if (Array.isArray(rawMsgs)) {
          msgs = rawMsgs;
        }
        // Group assistant messages by their `_turn` tag (added by the
        // worker when building candidate_outputs). Each turn block can
        // contain multiple assistant messages (tool call + follow-up
        // text) — we collapse them into one combined block per turn so
        // the per-turn row pairs correctly with its rationale.
        type AssistantBlock = {
          turn: number;
          texts: string[];
          toolCalls: unknown[];
          toolResults: string[];
        };
        const blocksByTurn = new Map<number, AssistantBlock>();
        let fallbackTurn = 0;
        for (const m of (msgs ?? []) as Array<Record<string, unknown>>) {
          if (!m || typeof m !== "object") continue;
          const role = m.role;
          if (role !== "assistant" && role !== "tool") continue;
          const turn =
            typeof m._turn === "number" && m._turn > 0
              ? (m._turn as number)
              : ++fallbackTurn;
          const slot =
            blocksByTurn.get(turn) ??
            ({ turn, texts: [], toolCalls: [], toolResults: [] } as AssistantBlock);
          if (role === "assistant") {
            const text = typeof m.content === "string" ? m.content : "";
            if (text) slot.texts.push(text);
            const tc = (m.tool_calls ?? m.toolCalls) as unknown[] | undefined;
            if (Array.isArray(tc) && tc.length > 0) slot.toolCalls.push(...tc);
          } else if (role === "tool") {
            const text = typeof m.content === "string" ? m.content : "";
            if (text) slot.toolResults.push(text);
          }
          blocksByTurn.set(turn, slot);
        }
        const assistantBlocks = Array.from(blocksByTurn.values()).sort(
          (a, b) => a.turn - b.turn,
        );

        const isPerTurn = parts.length > 1 || row.kind === "chat-replay-turn";

        if (!isPerTurn) {
          // One-shot row — two separate side-by-side panes.
          return (
            <>
              <Section title="Assistant turn(s) scored">
                <MessagesView value={msgs} />
              </Section>
              <Section title="Judge rationale">
                {row.judgeRationale ? (
                  <p className="whitespace-pre-wrap rounded border border-border bg-background/60 p-2 text-xs italic">
                    {row.judgeRationale}
                  </p>
                ) : (
                  <p className="text-[11px] italic text-muted-foreground">—</p>
                )}
              </Section>
            </>
          );
        }

        const rowCount = Math.max(assistantBlocks.length, parts.length, 1);
        return (
          <section className="space-y-2 lg:col-span-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assistant turn vs Judge rationale
            </h4>
            {/* Each turn is a 3-column grid row. `items-stretch` makes
                both side cards expand to the tallest card's height so
                the green assistant card and the rationale card always
                share the row height — no ragged bottoms even when one
                side has much more text. */}
            <div className="space-y-2">
              {Array.from({ length: rowCount }).map((_, i) => {
                const blk = assistantBlocks[i];
                // Trim runs of blank lines and edges so neither side
                // has a giant blank header/footer eating row height.
                const tidyBlock = (s: string) =>
                  s.replace(/\r/g, "").replace(/\n{2,}/g, "\n\n").trim();
                const aText = blk ? tidyBlock(blk.texts.join("\n\n")) : "";
                const aTc = blk && blk.toolCalls.length > 0 ? blk.toolCalls : undefined;
                const aToolResults = blk?.toolResults ?? [];
                const rat = tidyBlock(parts[i] ?? "");
                return (
                  <div
                    key={i}
                    className="grid items-stretch gap-2 sm:grid-cols-[3.5rem_1fr_1fr]"
                  >
                    <div className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Turn {i + 1}
                    </div>
                    <div className="flex flex-col rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px]">
                      <div className="mb-1 text-[10px] font-mono uppercase text-muted-foreground">
                        assistant
                      </div>
                      {aText ? (
                        <pre className="whitespace-pre-wrap break-words font-sans leading-snug">
                          {aText}
                        </pre>
                      ) : Array.isArray(aTc) && aTc.length > 0 ? (
                        // Tool-call-only turn (assistant produced no text,
                        // just function calls). Render the tool calls
                        // inline so the cell isn't just "—".
                        <div className="text-[11px] italic text-muted-foreground">
                          (no text reply — tool call only)
                        </div>
                      ) : (
                        <span className="italic text-muted-foreground">—</span>
                      )}
                      {Array.isArray(aTc) && aTc.length > 0 && (
                        <details open={!aText} className="mt-1">
                          <summary className="cursor-pointer select-none text-[10px] text-muted-foreground">
                            {aTc.length} tool_call(s)
                          </summary>
                          <Pre value={aTc} compact />
                        </details>
                      )}
                      {aToolResults.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer select-none text-[10px] text-muted-foreground">
                            {aToolResults.length} tool_result(s)
                          </summary>
                          <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-border bg-background p-2 font-mono text-[10px] text-muted-foreground">
                            {aToolResults.join("\n---\n")}
                          </pre>
                        </details>
                      )}
                    </div>
                    <div className="flex flex-col rounded-md border border-indigo-500/30 bg-indigo-500/5 p-2 text-[11px]">
                      <div className="mb-1 text-[10px] font-mono uppercase text-muted-foreground">
                        judge rationale
                      </div>
                      {rat ? (
                        <p className="whitespace-pre-wrap italic">{rat}</p>
                      ) : (
                        <span className="italic text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {row.judgeScores && rubricAxes && rubricAxes.length > 0 && (() => {
        // Old rows store judgeScores as a JSON-encoded string; parse once
        // so the score lookup below sees an actual object.
        let scores: Record<string, number> | null = null;
        if (typeof row.judgeScores === "string") {
          try {
            const parsed = JSON.parse(row.judgeScores);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              scores = parsed as Record<string, number>;
            }
          } catch {
            scores = null;
          }
        } else if (
          typeof row.judgeScores === "object" &&
          !Array.isArray(row.judgeScores)
        ) {
          scores = row.judgeScores as Record<string, number>;
        }
        if (!scores) return null;
        return (
        <Section title="Judge scores" full>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rubricAxes.map((a) => {
              const s = scores?.[a.key];
              const scale = a.scale ?? 5;
              const frac =
                typeof s === "number" ? Math.max(0, Math.min(1, (s - 1) / (scale - 1))) : null;
              return (
                <div key={a.key} className="rounded border border-border bg-card p-2 text-[11px]">
                  <div className="mb-0.5 flex items-center justify-between gap-2">
                    <span className="font-medium">{a.name ?? a.key}</span>
                    <span className="font-mono">
                      {typeof s === "number" ? `${s}/${scale}` : "—"}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-foreground/70"
                      style={{ width: frac == null ? "0%" : `${frac * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
        );
      })()}

      {row.validatorScores && (() => {
        // Defensive parse: older rows have validatorScores stored as a
        // JSON-encoded string (worker wrote it without `::jsonb` cast).
        // Try parsing once; if the result isn't a plain object, drop it
        // entirely so we don't render character indices as keys.
        let scores: Record<string, unknown> | null = null;
        if (typeof row.validatorScores === "string") {
          try {
            const parsed = JSON.parse(row.validatorScores);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              scores = parsed as Record<string, unknown>;
            }
          } catch {
            scores = null;
          }
        } else if (
          typeof row.validatorScores === "object" &&
          !Array.isArray(row.validatorScores)
        ) {
          scores = row.validatorScores as Record<string, unknown>;
        }
        if (!scores || Object.keys(scores).length === 0) return null;
        return (
        <Section title="Deterministic validators on candidate" full>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(scores).map(([k, raw]) => {
              const v = raw as {
                axis?: string;
                verdict?: string;
                score?: number | null;
                details?: unknown;
              };
              return (
                <div key={k} className="rounded border border-border bg-card p-2 text-[11px]">
                  <div className="mb-0.5 flex items-center justify-between gap-2">
                    <span className="font-mono">{k}</span>
                    <Badge
                      variant={VERDICT_VARIANT[v.verdict ?? ""] ?? "outline"}
                      className="text-[10px]"
                    >
                      {v.verdict ?? "—"}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground">
                    axis: {v.axis ?? "—"}
                    {typeof v.score === "number" && <> · score: {v.score.toFixed(2)}</>}
                  </div>
                  {v.details ? <Pre value={v.details} compact /> : null}
                </div>
              );
            })}
          </div>
        </Section>
        );
      })()}

      {row.functionCallScore && row.functionCallScore.length > 0 && (
        <Section title="Function-call comparison" full>
          <Pre value={row.functionCallScore} />
        </Section>
      )}

      {row.conversationId && (
        <p className="text-[11px] text-muted-foreground">
          Source conversation:{" "}
          <Link
            href={`/projects/${projectId}/conversations?focus=${row.conversationId}`}
            className="inline-flex items-center gap-1 font-mono hover:text-foreground hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.conversationId}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  full,
}: {
  title: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <section className={full ? "lg:col-span-2" : ""}>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

function MessagesView({ value }: { value: unknown[] | null }) {
  // Defensive parse: older rows persist this JSON column as a
  // JSON-encoded *string* (no `::jsonb` cast in the worker). Try parsing
  // once so the view renders even on legacy data.
  let arr: unknown[] | null = value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = null;
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    return <p className="text-[11px] italic text-muted-foreground">—</p>;
  }
  const value2 = arr;
  return (
    <div className="space-y-1">
      {(value2 as Array<Record<string, unknown>>).map((m, i) => {
        const role = String(m.role ?? "?");
        const content = String(m.content ?? "");
        const tc = m.tool_calls ?? m.toolCalls;
        const tone =
          role === "system"
            ? "border-amber-500/30 bg-amber-500/5"
            : role === "user"
              ? "border-blue-500/30 bg-blue-500/5"
              : role === "assistant"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border";
        return (
          <div key={i} className={`rounded-md border p-2 text-[11px] ${tone}`}>
            <div className="mb-0.5 text-[10px] font-mono uppercase text-muted-foreground">{role}</div>
            <pre className="whitespace-pre-wrap break-words font-sans leading-snug">
              {content}
            </pre>
            {tc != null && Array.isArray(tc) && tc.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer select-none text-[10px] text-muted-foreground">
                  {Array.isArray(tc) ? tc.length : 0} tool_call(s)
                </summary>
                <Pre value={tc} compact />
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Pre({ value, compact }: { value: unknown; compact?: boolean }) {
  return (
    <pre
      className={
        compact
          ? "mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-background/70 p-1 font-mono text-[10px] leading-snug"
          : "max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background/60 p-2 font-mono text-[11px] leading-snug"
      }
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
