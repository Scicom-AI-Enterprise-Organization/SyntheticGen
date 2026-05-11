"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Download, FileJson, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: string;
  content: string | null;
  reasoningContent: string | null;
  ordinal: number;
  language: string | null;
  tokenCount: number | null;
  latencyMs: number | null;
  model: string | null;
}

interface Validation {
  id: string;
  validatorKind: string;
  axis: string;
  verdict: string;
  score: number | null;
  details: Record<string, unknown> | null;
}

interface DrawerData {
  id: string;
  status: string;
  primaryLanguage: string | null;
  difficulty: string | null;
  persona: string | null;
  topic: string | null;
  messages: Message[];
  validations: Validation[];
}

// Loose shape — we render fields defensively since the trace evolves.
type TraceDoc = Record<string, unknown>;

const VERDICT_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pass: "default",
  warn: "secondary",
  fail: "destructive",
};

export function ConversationDrawer({
  projectId,
  conversationId,
  initialTab = "messages",
  onClose,
}: {
  projectId: string;
  conversationId: string;
  initialTab?: "messages" | "trace";
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [data, setData] = useState<DrawerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trace tab state — lazy-loaded.
  const [trace, setTrace] = useState<TraceDoc | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [tab, setTab] = useState<"messages" | "trace">(initialTab);

  const onTabChange = useCallback(
    (next: "messages" | "trace") => {
      setTab(next);
      const params = new URLSearchParams(window.location.search);
      if (next === "messages") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/conversations/${conversationId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`http ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, conversationId]);

  // Lazy-load the trace the first time the user opens the Trace tab.
  // NOTE: do not include `traceLoading` in deps — setting it inside the effect
  // would re-trigger the effect, whose cleanup cancels the in-flight closure
  // and leaves the UI stuck at "Loading trace…".
  useEffect(() => {
    if (tab !== "trace" || trace) return;
    let cancelled = false;
    setTraceLoading(true);
    setTraceError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const url = `/api/projects/${projectId}/conversations/${conversationId}/trace`;
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (r) => {
        const ct = r.headers.get("content-type") ?? "";
        const text = await r.text();
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}${text ? `: ${text.slice(0, 400)}` : ""}`);
        }
        if (!ct.includes("application/json")) {
          throw new Error(
            `Non-JSON response (Content-Type: ${ct || "?"}): ${text.slice(0, 200)}`,
          );
        }
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error(`Bad JSON: ${(e as Error).message} — head: ${text.slice(0, 200)}`);
        }
      })
      .then((d) => {
        if (!cancelled) setTrace(d);
      })
      .catch((e) => {
        const err = e as Error;
        // Surface the failure in devtools too so it's easy to diagnose.
        console.error("[trace fetch] failed", { url, err });
        if (!cancelled) {
          setTraceError(
            err.name === "AbortError"
              ? "Trace request timed out after 30s — check the Next.js dev server logs."
              : err.message,
          );
        }
      })
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setTraceLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [tab, trace, projectId, conversationId]);

  function downloadJSON() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversation-${conversationId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadTrace() {
    const a = document.createElement("a");
    a.href = `/api/projects/${projectId}/conversations/${conversationId}/trace?download=1`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40"
        role="button"
        aria-label="Close"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Conversation</div>
            <div className="truncate font-mono text-xs">{conversationId}</div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={downloadJSON}
              disabled={!data}
              title="Download the conversation as JSON"
            >
              <FileJson className="mr-1 h-3 w-3" />
              JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadTrace}
              title="Download the full provenance"
            >
              <Download className="mr-1 h-3 w-3" />
              Trace
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 text-sm">
          {loading && <p className="text-muted-foreground">Loading…</p>}
          {error && <p className="text-destructive">Failed: {error}</p>}
          {data && (
            <>
              <div className="mb-4 flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">status: {data.status}</Badge>
                {data.primaryLanguage && <Badge variant="outline">{data.primaryLanguage}</Badge>}
                {data.difficulty && <Badge variant="outline">{data.difficulty}</Badge>}
                {data.persona && <Badge variant="outline">{data.persona}</Badge>}
                {data.topic && <Badge variant="outline">{data.topic}</Badge>}
              </div>

              <Tabs value={tab} onValueChange={(v) => onTabChange(v as typeof tab)}>
                <TabsList>
                  <TabsTrigger value="messages">Messages</TabsTrigger>
                  <TabsTrigger value="trace">Trace</TabsTrigger>
                </TabsList>

                <TabsContent value="messages" className="space-y-4">
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                      Validations
                    </h3>
                    <div className="space-y-1">
                      {data.validations.length === 0 ? (
                        <p className="text-xs text-muted-foreground">None.</p>
                      ) : (
                        data.validations.map((v) => (
                          <div
                            key={v.id}
                            className="rounded-md border border-border bg-card p-2 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono">{v.validatorKind}</span>
                              <span className="text-muted-foreground">{v.axis}</span>
                              <Badge
                                variant={VERDICT_VARIANT[v.verdict] ?? "outline"}
                                className="text-[10px]"
                              >
                                {v.verdict}
                              </Badge>
                            </div>
                            {v.details && (
                              <pre className="mt-1 overflow-x-auto text-[10px] text-muted-foreground">
                                {JSON.stringify(v.details)}
                              </pre>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                      Messages
                    </h3>
                    <div className="space-y-2">
                      {data.messages.map((m) => (
                        <div
                          key={m.id}
                          className={cn(
                            "rounded-md border p-2 text-xs",
                            m.role === "system"
                              ? "border-amber-500/30 bg-amber-500/5"
                              : m.role === "user"
                                ? "border-blue-500/30 bg-blue-500/5"
                                : m.role === "assistant"
                                  ? "border-emerald-500/30 bg-emerald-500/5"
                                  : "border-border",
                          )}
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="font-mono uppercase">{m.role}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {m.language ?? "—"}
                              {m.tokenCount != null && ` · ${m.tokenCount} tok`}
                              {m.model && ` · ${m.model}`}
                            </span>
                          </div>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-xs leading-snug">
                            {m.content ?? ""}
                          </pre>
                          {m.reasoningContent && (
                            <details className="mt-2 rounded-md border border-border/70 bg-background/60">
                              <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-medium text-muted-foreground">
                                Reasoning ({m.reasoningContent.length} chars)
                              </summary>
                              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t border-border/60 px-2 py-2 font-mono text-[10px] italic text-muted-foreground">
                                {m.reasoningContent}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </TabsContent>

                <TabsContent value="trace" className="space-y-3">
                  {traceLoading && <p className="text-muted-foreground">Loading trace…</p>}
                  {traceError && <p className="text-destructive">Failed: {traceError}</p>}
                  {trace && <TraceView trace={trace} />}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────

interface TraceEvent {
  id: string;
  ts: string;
  kind: string;
  // Server sometimes returns this as a JSON-encoded string (depending on how
  // the worker persisted it). Accept either; consumers should normalize with
  // `asObject` before reading fields.
  payload: Record<string, unknown> | string | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function TraceView({ trace }: { trace: TraceDoc }) {
  const run = pick(trace, "run");
  const job = pick(trace, "job");
  const persona = pick(trace, "persona");
  const taxonomyNode = pick(trace, "taxonomyNode");
  const conv = pick(trace, "conversation");
  const events = (Array.isArray(trace.events) ? trace.events : []) as TraceEvent[];

  const template = run ? pick(run, "template") : null;
  const lp = run ? pick(run, "languageProfile") : null;
  const provider = run ? pick(run, "provider") : null;
  const sampling = run ? pick(run, "samplingParams") : null;
  const config = run ? pick(run, "configSnapshot") : null;
  const grid = run ? pick(run, "gridSpec") : null;

  return (
    <div className="space-y-3">
      {events.length > 0 && <Timeline events={events} />}

      <Panel title="Conversation" subtitle={asString(conv, "id")}>
        <KV
          rows={[
            ["status", asString(conv, "status")],
            ["language / script", joinPair(asString(conv, "primaryLanguage"), asString(conv, "primaryScript"))],
            ["difficulty", asString(conv, "difficulty")],
            ["turns", asString(conv, "turnCount")],
            ["tokens", asString(conv, "tokenCount")],
            ["createdAt", asString(conv, "createdAt")],
          ]}
        />
      </Panel>

      <Panel title="Run" subtitle={asString(run, "name")}>
        <KV
          rows={[
            ["id", asString(run, "id")],
            ["model", asString(run, "model")],
            ["status", asString(run, "status")],
            ["formalityPolicy", asString(run, "formalityPolicy")],
            ["targetCount", asString(run, "targetCount")],
            ["producedCount", asString(run, "producedCount")],
            ["acceptedCount", asString(run, "acceptedCount")],
            ["tokens (in/out)", `${asString(run, "tokensIn")} / ${asString(run, "tokensOut")}`],
            ["cost (USD)", asString(run, "costUsd")],
            ["startedAt", asString(run, "startedAt")],
            ["completedAt", asString(run, "completedAt")],
          ]}
        />
      </Panel>

      {sampling && (
        <Panel title="Sampling params">
          <KV rows={Object.entries(sampling).map(([k, v]) => [k, fmt(v)])} />
        </Panel>
      )}

      {provider && (
        <Panel title="Provider" subtitle={asString(provider, "name")}>
          <KV
            rows={[
              ["kind", asString(provider, "kind")],
              ["baseUrl", asString(provider, "baseUrl")],
              ["defaultModel", asString(provider, "defaultModel")],
              ["keyFingerprint", asString(provider, "keyFingerprint")],
              ["reasoningEffort", asString(provider, "reasoningEffort")],
            ]}
          />
          {hasKeys(pick(provider, "chatTemplateKwargs")) && (
            <DetailsJson label="chat_template_kwargs" value={pick(provider, "chatTemplateKwargs")} />
          )}
        </Panel>
      )}

      {template && (
        <Panel title="Template" subtitle={`${asString(template, "name")} (${asString(template, "kind")})`}>
          <KV
            rows={[
              ["id", asString(template, "id")],
              ["version", asString(template, "version")],
              ["description", asString(template, "description")],
            ]}
          />
          {asString(template, "body") && (
            <details open className="mt-2 rounded-md border border-border bg-muted/20">
              <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-medium text-muted-foreground">
                Body
              </summary>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2 py-2 font-mono text-[10px]">
                {asString(template, "body")}
              </pre>
            </details>
          )}
        </Panel>
      )}

      {persona && (
        <Panel title="Persona" subtitle={asString(persona, "name")}>
          <KV
            rows={[
              ["ethnicity", asString(persona, "ethnicity")],
              ["region", asString(persona, "region")],
              ["urbanity", asString(persona, "urbanity")],
              ["ageRange", asString(persona, "ageRange")],
              ["formality", asString(persona, "formality")],
              ["religionAware", asString(persona, "religionAware")],
              ["dialectTags", fmt(pick(persona, "dialectTags"))],
            ]}
          />
        </Panel>
      )}

      {taxonomyNode && (
        <Panel title="Taxonomy node" subtitle={asString(taxonomyNode, "name")}>
          <KV
            rows={[
              ["id", asString(taxonomyNode, "id")],
              ["slug", asString(taxonomyNode, "slug")],
              ["path", asString(taxonomyNode, "path")],
              ["depth", asString(taxonomyNode, "depth")],
            ]}
          />
        </Panel>
      )}

      {lp && (
        <Panel title="Language profile" subtitle={asString(lp, "name")}>
          <KV
            rows={[
              ["primary", asString(lp, "primary")],
              ["secondary", fmt(pick(lp, "secondary"))],
              ["script", asString(lp, "script")],
              ["register", asString(lp, "register")],
              ["allowParticles", asString(lp, "allowParticles")],
              ["codeSwitchPolicy", asString(lp, "codeSwitchPolicy")],
              ["codeSwitchRate", asString(lp, "codeSwitchRate")],
              ["requireFormalMalay", asString(lp, "requireFormalMalay")],
              ["englishLoanwordPolicy", asString(lp, "englishLoanwordPolicy")],
            ]}
          />
          {hasKeys(pick(lp, "bannedTokens")) && (
            <DetailsJson label="bannedTokens" value={pick(lp, "bannedTokens")} />
          )}
          {hasKeys(pick(lp, "loanwordAllowlist")) && (
            <DetailsJson label="loanwordAllowlist" value={pick(lp, "loanwordAllowlist")} />
          )}
        </Panel>
      )}

      {job && (
        <Panel title="Generation job">
          <KV
            rows={[
              ["id", asString(job, "id")],
              ["cellKey", asString(job, "cellKey")],
              ["status", asString(job, "status")],
              ["attempts", asString(job, "attempts")],
              ["startedAt", asString(job, "startedAt")],
              ["finishedAt", asString(job, "finishedAt")],
              ["latencyMs", asString(job, "latencyMs")],
              ["tokens (in/out)", `${asString(job, "tokensIn")} / ${asString(job, "tokensOut")}`],
              ["costUsd", asString(job, "costUsd")],
            ]}
          />
          {asString(job, "lastError") && (
            <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
              {asString(job, "lastError")}
            </p>
          )}
          {hasKeys(pick(job, "inputContext")) && (
            <DetailsJson label="inputContext" value={pick(job, "inputContext")} />
          )}
        </Panel>
      )}

      {grid && <DetailsJson label="Grid spec" value={grid} open />}
      {config && <DetailsJson label="Full config snapshot" value={config} />}
    </div>
  );
}

const EVENT_KIND_LABEL: Record<string, string> = {
  "job.start": "Job picked up",
  "context.loaded": "Context loaded (persona / topic / profile / template)",
  "knowledge.loaded": "Knowledge base entries loaded",
  "prompt.rendered": "Prompt rendered",
  "provider.request": "Provider call dispatched",
  "provider.stream.reasoning.start": "Reasoning stream started",
  "provider.stream.content.start": "Content stream started",
  "provider.response": "Provider response complete",
  "validator.run": "Validator ran",
  "conversation.persisted": "Conversation persisted",
  "job.error": "Job failed",
};

const EVENT_KIND_COLOR: Record<string, string> = {
  "job.start": "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-300",
  "context.loaded": "border-blue-500/30 bg-blue-500/5",
  "knowledge.loaded": "border-fuchsia-500/30 bg-fuchsia-500/5",
  "prompt.rendered": "border-purple-500/30 bg-purple-500/5",
  "provider.request": "border-cyan-500/30 bg-cyan-500/5",
  "provider.stream.reasoning.start": "border-muted-foreground/30 bg-muted/30 italic",
  "provider.stream.content.start": "border-emerald-500/30 bg-emerald-500/5",
  "provider.response": "border-emerald-500/40 bg-emerald-500/10",
  "validator.run": "border-amber-500/30 bg-amber-500/5",
  "conversation.persisted": "border-emerald-500/40 bg-emerald-500/10",
  "job.error": "border-destructive/40 bg-destructive/10 text-destructive",
};

function Timeline({ events }: { events: TraceEvent[] }) {
  const t0 = events[0] ? new Date(events[0].ts).getTime() : 0;

  return (
    <section className="rounded-md border border-border bg-card p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Build timeline
        </h4>
        <span className="text-[11px] text-muted-foreground">
          {events.length} event{events.length === 1 ? "" : "s"}
        </span>
      </header>
      <ol className="relative space-y-2 border-l border-border pl-4">
        {events.map((e) => {
          const t = new Date(e.ts).getTime();
          const offsetMs = t - t0;
          const summary = summarizeEvent(e);
          const tone = EVENT_KIND_COLOR[e.kind] ?? "border-border bg-card";
          return (
            <li key={e.id} className="relative">
              <span className="absolute -left-[1.05rem] top-2 h-2 w-2 rounded-full bg-foreground/60 ring-2 ring-background" />
              <details className={`rounded-md border p-2 text-[11px] ${tone}`}>
                <summary className="cursor-pointer select-none">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    +{formatOffset(offsetMs)}
                  </span>
                  <span className="ml-2 font-medium">
                    {EVENT_KIND_LABEL[e.kind] ?? e.kind}
                  </span>
                  {summary && (
                    <span className="ml-2 text-muted-foreground">— {summary}</span>
                  )}
                </summary>
                {e.payload != null && (
                  <div className="mt-2 max-h-72 overflow-auto rounded border border-border/60 bg-background/70 px-2 py-1">
                    <JsonTree value={e.payload} />
                  </div>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function summarizeEvent(e: TraceEvent): string | null {
  const p = asObject(e.payload) ?? {};
  switch (e.kind) {
    case "job.start":
      return (p as { cellKey?: string }).cellKey ?? null;
    case "context.loaded": {
      const persona = (p as { persona?: { name?: string } }).persona;
      const tax = (p as { taxonomy?: { name?: string } }).taxonomy;
      const model = (p as { model?: string }).model;
      const kb = (p as { knowledgeBaseMatches?: number }).knowledgeBaseMatches;
      const bits = [
        tax?.name && `topic: ${tax.name}`,
        persona?.name && `persona: ${persona.name}`,
        model && `model: ${model}`,
        kb != null && `KB: ${kb}`,
      ].filter(Boolean);
      return bits.length > 0 ? bits.join(" · ") : null;
    }
    case "knowledge.loaded": {
      const count = (p as { count?: number }).count;
      const entries = (p as { entries?: { title?: string }[] }).entries ?? [];
      const titles = entries
        .map((e) => e.title)
        .filter((t): t is string => Boolean(t))
        .slice(0, 3)
        .join(", ");
      return `${count ?? entries.length} entr${(count ?? entries.length) === 1 ? "y" : "ies"}${titles ? ` — ${titles}${entries.length > 3 ? "…" : ""}` : ""}`;
    }
    case "prompt.rendered": {
      const u = (p as { userText?: string }).userText ?? "";
      return u ? `${u.length} chars` : null;
    }
    case "provider.request": {
      const sp = (p as { samplingParams?: { temperature?: number; max_tokens?: number } })
        .samplingParams;
      const re = (p as { reasoningEffort?: string }).reasoningEffort;
      return [
        sp?.temperature != null && `temp=${sp.temperature}`,
        sp?.max_tokens != null && `max=${sp.max_tokens}`,
        re && `effort=${re}`,
      ]
        .filter(Boolean)
        .join(" · ") || null;
    }
    case "provider.stream.content.start":
      return `after ${(p as { afterReasoningChars?: number }).afterReasoningChars ?? 0} chars of reasoning`;
    case "provider.response": {
      const tIn = (p as { tokensIn?: number }).tokensIn;
      const tOut = (p as { tokensOut?: number }).tokensOut;
      const ms = (p as { latencyMs?: number }).latencyMs;
      return `${tIn}/${tOut} tok · ${ms} ms`;
    }
    case "validator.run": {
      const k = (p as { validatorKind?: string }).validatorKind;
      const a = (p as { axis?: string }).axis;
      const v = (p as { verdict?: string }).verdict;
      return `${k}/${a} → ${v}`;
    }
    case "conversation.persisted":
      return `${(p as { status?: string }).status ?? ""}`;
    case "job.error":
      return ((p as { error?: string }).error ?? "").slice(0, 120);
    default:
      return null;
  }
}

function formatOffset(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
        {subtitle && <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

function KV({ rows }: { rows: Array<[string, string | null]> }) {
  const filtered = rows.filter(([, v]) => v !== null && v !== "" && v !== "null");
  if (filtered.length === 0) return null;
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-2 gap-y-1 text-[11px]">
      {filtered.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailsJson({
  label,
  value,
  open = false,
}: {
  label: string;
  value: unknown;
  open?: boolean;
}) {
  return (
    <details open={open} className="mt-2 rounded-md border border-border bg-muted/20">
      <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-medium text-muted-foreground">
        {label}
      </summary>
      <div className="max-h-60 overflow-auto border-t border-border px-2 py-2">
        <JsonTree value={value} />
      </div>
    </details>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Collapsible JSON tree. Renders objects/arrays as native <details> nodes so
// every key can be expanded or collapsed independently. Strings that *look*
// like JSON (e.g. `payload` columns persisted as JSON-encoded strings) are
// parsed on the fly so the user sees the structure, not an escaped blob.

function maybeParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (
    !(t.startsWith("{") && t.endsWith("}")) &&
    !(t.startsWith("[") && t.endsWith("]"))
  ) {
    return value;
  }
  try {
    return JSON.parse(t);
  } catch {
    return value;
  }
}

function JsonTree({ value }: { value: unknown }) {
  const v = maybeParseJson(value);
  if (v && typeof v === "object") {
    const entries: Array<[string, unknown]> = Array.isArray(v)
      ? v.map((item, i) => [String(i), item])
      : Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <span className="font-mono text-[10px] text-muted-foreground">
          {Array.isArray(v) ? "[]" : "{}"}
        </span>
      );
    }
    return (
      <div className="font-mono text-[10px] leading-snug">
        {entries.map(([k, val]) => (
          <JsonNode key={k} name={k} value={val} depth={1} />
        ))}
      </div>
    );
  }
  return <JsonNode value={v} depth={1} />;
}

function JsonNode({
  name,
  value,
  depth,
}: {
  name?: string;
  value: unknown;
  depth: number;
}) {
  const v = maybeParseJson(value);
  const key =
    name !== undefined ? (
      <>
        <span className="text-blue-700 dark:text-blue-300">{name}</span>
        <span className="text-muted-foreground">: </span>
      </>
    ) : null;

  if (v === null) return <Leaf>{key}<span className="text-muted-foreground">null</span></Leaf>;
  if (typeof v === "string")
    return (
      <Leaf>
        {key}
        <span className="break-all text-emerald-700 dark:text-emerald-300">
          &quot;{v}&quot;
        </span>
      </Leaf>
    );
  if (typeof v === "number")
    return (
      <Leaf>
        {key}
        <span className="text-amber-700 dark:text-amber-300">{String(v)}</span>
      </Leaf>
    );
  if (typeof v === "boolean")
    return (
      <Leaf>
        {key}
        <span className="text-purple-700 dark:text-purple-300">{String(v)}</span>
      </Leaf>
    );

  if (Array.isArray(v)) {
    if (v.length === 0)
      return (
        <Leaf>
          {key}
          <span className="text-muted-foreground">[]</span>
        </Leaf>
      );
    return (
      <details open={depth < 2} className="block">
        <summary className="cursor-pointer select-none break-all">
          {key}
          <span className="text-muted-foreground">[{v.length}]</span>
        </summary>
        <div className="ml-3 border-l border-border/50 pl-2">
          {v.map((item, i) => (
            <JsonNode key={i} name={String(i)} value={item} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0)
      return (
        <Leaf>
          {key}
          <span className="text-muted-foreground">{`{}`}</span>
        </Leaf>
      );
    return (
      <details open={depth < 2} className="block">
        <summary className="cursor-pointer select-none break-all">
          {key}
          <span className="text-muted-foreground">{`{${entries.length}}`}</span>
        </summary>
        <div className="ml-3 border-l border-border/50 pl-2">
          {entries.map(([k, val]) => (
            <JsonNode key={k} name={k} value={val} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <Leaf>
      {key}
      <span>{String(v)}</span>
    </Leaf>
  );
}

function Leaf({ children }: { children: React.ReactNode }) {
  return <div className="break-all">{children}</div>;
}

// Defensive accessors — trace doc shape evolves, so don't blow up on missing keys.
function pick(obj: unknown, key: string): TraceDoc | null {
  if (obj && typeof obj === "object" && key in obj) {
    return (obj as Record<string, unknown>)[key] as TraceDoc;
  }
  return null;
}

function asString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function fmt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length === 0 ? null : v.map(String).join(", ");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function joinPair(a: string | null, b: string | null): string | null {
  if (!a && !b) return null;
  if (!b) return a;
  if (!a) return b;
  return `${a} / ${b}`;
}

function hasKeys(v: unknown): boolean {
  if (!v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return false;
}
