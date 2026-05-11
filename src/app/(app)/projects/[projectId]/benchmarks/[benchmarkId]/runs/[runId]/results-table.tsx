"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  results,
  rubricAxes,
  isChatReplay,
}: {
  results: ResultRow[];
  rubricAxes: RubricAxisLite[] | null;
  isChatReplay: boolean;
}) {
  const [verdict, setVerdict] = useState<string>(ALL);
  const [split, setSplit] = useState<string>(ALL);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

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
          className="h-7 max-w-sm text-xs"
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
            {filtered.map((r) => {
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
                    {isChatReplay && rubricAxes && (
                      <td className="py-3 pr-4 text-[11px]">
                        <div className="flex flex-wrap gap-1">
                          {rubricAxes.map((a) => {
                            const s = r.judgeScores?.[a.key];
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
                    )}
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
                        <ResultDrilldown row={r} rubricAxes={rubricAxes} isChatReplay={isChatReplay} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultDrilldown({
  row,
  rubricAxes,
  isChatReplay,
}: {
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
      <Section title="Reference (project-generated)">
        <MessagesView value={row.referenceMessages} />
      </Section>
      <Section title="Candidate">
        <MessagesView value={row.candidateMessages} />
      </Section>

      {row.judgeRationale && (
        <Section title="Judge rationale" full>
          <p className="whitespace-pre-wrap rounded border border-border bg-background/60 p-2 text-xs italic">
            {row.judgeRationale}
          </p>
        </Section>
      )}

      {row.judgeScores && rubricAxes && rubricAxes.length > 0 && (
        <Section title="Judge scores" full>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rubricAxes.map((a) => {
              const s = row.judgeScores?.[a.key];
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
      )}

      {row.validatorScores && Object.keys(row.validatorScores).length > 0 && (
        <Section title="Deterministic validators on candidate" full>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(row.validatorScores).map(([k, raw]) => {
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
      )}

      {row.functionCallScore && row.functionCallScore.length > 0 && (
        <Section title="Function-call comparison" full>
          <Pre value={row.functionCallScore} />
        </Section>
      )}

      {row.conversationId && (
        <p className="text-[11px] text-muted-foreground">
          Source conversation: <code className="font-mono">{row.conversationId}</code>
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
  if (!Array.isArray(value) || value.length === 0) {
    return <p className="text-[11px] italic text-muted-foreground">—</p>;
  }
  return (
    <div className="space-y-1">
      {(value as Array<Record<string, unknown>>).map((m, i) => {
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
