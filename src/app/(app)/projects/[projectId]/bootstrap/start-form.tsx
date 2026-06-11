"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Wand2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThroughputBadge } from "@/components/throughput-badge";
import { startBootstrap } from "./actions";

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string | null;
}

const SCOPE_ITEMS: Array<{
  key: keyof Scope;
  label: string;
  hint: string;
}> = [
  { key: "taxonomy", label: "Taxonomy nodes", hint: "8 topic nodes" },
  { key: "languages", label: "Language profiles", hint: "2 register profiles" },
  { key: "personas", label: "Personas", hint: "4 demographically varied personas" },
  { key: "templates", label: "Templates", hint: "System + user-seed templates" },
  { key: "tools", label: "Tools", hint: "3 function-calling tool defs" },
  { key: "flows", label: "Flows", hint: "1 multi-turn flow DAG" },
  { key: "rubrics", label: "Rubrics", hint: "1 benchmark scoring rubric" },
  {
    key: "benchmarks",
    label: "Benchmarks",
    hint: "1 chat-replay benchmark wired to the rubric",
  },
];

type Scope = {
  taxonomy: boolean;
  languages: boolean;
  personas: boolean;
  templates: boolean;
  tools: boolean;
  flows: boolean;
  rubrics: boolean;
  benchmarks: boolean;
};

const DEFAULT_SCOPE: Scope = {
  taxonomy: true,
  languages: true,
  personas: true,
  templates: true,
  tools: true,
  flows: true,
  rubrics: true,
  benchmarks: true,
};

const EXAMPLE_PROMPT =
  "Malaysian retail-bank customer support — formal Bahasa baku for general inquiries, and casual Manglish for younger demographics. Should cover billing, account access, fraud, and product queries.";

export function StartForm({
  projectId,
  providers,
  existingToolsCount = 0,
  existingToolsSummary = null,
}: {
  projectId: string;
  providers: ProviderOption[];
  existingToolsCount?: number;
  existingToolsSummary?: string | null;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [model, setModel] = useState(providers[0]?.defaultModel ?? "");
  // Sampling knobs as numbers (driven by range sliders). 0.7 / 16k is a
  // good middle ground for bootstrap runs — enough creativity to vary
  // across personas/templates without going off the rails, and enough
  // tokens for any of the kinds (tools + flows are the longest).
  const [temperature, setTemperature] = useState<number>(0.7);
  const [maxTokens, setMaxTokens] = useState<number>(16384);
  // "Use my existing tools as context" — opt-in toggle. When ON (the
  // default, if any tools exist), the catalog is fed into the Suggest
  // button and orchestrator phases so the generated entities reference
  // these tools instead of inventing new ones. When OFF, bootstrap runs
  // cold as if the catalog didn't exist.
  const [useToolsContext, setUseToolsContextRaw] = useState<boolean>(
    existingToolsCount > 0,
  );
  // When the project already has a tool catalog AND the user is using it
  // as context, default the `tools` scope to OFF — re-generating would
  // inflate the catalog with duplicates of what the user just uploaded.
  const [scope, setScope] = useState<Scope>(() =>
    existingToolsCount > 0 ? { ...DEFAULT_SCOPE, tools: false } : DEFAULT_SCOPE,
  );

  function setUseToolsContext(next: boolean) {
    setUseToolsContextRaw(next);
    // Keep the Tools scope checkbox in sync — when the user toggles
    // "Bootstrap from existing tools" OFF, they probably want a fresh
    // tool catalog generated too; when ON, hide it to avoid duplication.
    setScope((s) => ({ ...s, tools: !next }));
  }
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Suggest dialog state — opens on click, streams reasoning + content
  // from the project's random-prompt endpoint, then lets the user accept
  // or discard the result.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestReasoning, setSuggestReasoning] = useState("");
  const [suggestContent, setSuggestContent] = useState("");
  const [suggestInfo, setSuggestInfo] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestStartedAt, setSuggestStartedAt] = useState<number | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const suggestReasoningBoxRef = useRef<HTMLPreElement | null>(null);
  const suggestContentBoxRef = useRef<HTMLPreElement | null>(null);

  function autoScroll(ref: React.RefObject<HTMLPreElement | null>) {
    queueMicrotask(() => {
      const el = ref.current;
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance <= 64) el.scrollTop = el.scrollHeight;
    });
  }

  async function runSuggest() {
    if (!providerId) {
      setSuggestError("Pick a provider before suggesting.");
      return;
    }
    setSuggestError(null);
    setSuggestInfo(null);
    setSuggestReasoning("");
    setSuggestContent("");
    setSuggesting(true);
    setSuggestStartedAt(Date.now());
    const controller = new AbortController();
    suggestAbortRef.current = controller;
    const wantToolsContext = useToolsContext && Boolean(existingToolsSummary);
    const description = wantToolsContext
      ? "Invent ONE concise project-bootstrap prompt for a Malaysia-focused synthetic-data project whose assistant can call the EXISTING tools listed below. The prompt should describe the domain, the typical users, the topics covered, and the language register(s) — so a downstream LLM can generate matching taxonomy / personas / templates / flows. Reference the tools' subject area but do NOT list tool names. ONE to TWO sentences only — this text will be used as the bootstrap prompt."
      : "Invent ONE concise project-bootstrap prompt for a Malaysia-focused synthetic-data project. Describe the domain, the typical users, the topics covered, and the language register(s) — so a downstream LLM can generate matching taxonomy / personas / templates / flows / tools. ONE to TWO sentences only.";
    try {
      const res = await fetch(
        `/api/projects/${projectId}/random-prompt?stream=1`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerId,
            description,
            extraContext: wantToolsContext
              ? `EXISTING TOOL CATALOG (${existingToolsCount} tools) — the project's assistant can already call these. Infer the domain/use-case from them and write a prompt that fits.\n${existingToolsSummary}`
              : null,
            maxTokens: 4000,
          }),
          signal: controller.signal,
        },
      );
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `http ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let live = "";
      let liveReasoning = "";
      let finalText: string | null = null;
      let modelUsed = "";
      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(t);
          } catch {
            continue;
          }
          const type = evt.type as string;
          if (type === "start") {
            modelUsed = (evt.model as string) ?? "";
            if (modelUsed) setSuggestInfo(`Streaming from ${modelUsed}…`);
          } else if (type === "delta") {
            const text = (evt.text as string) ?? "";
            if (evt.reasoning) {
              liveReasoning += text;
              setSuggestReasoning(liveReasoning);
              autoScroll(suggestReasoningBoxRef);
            } else {
              live += text;
              setSuggestContent(live);
              autoScroll(suggestContentBoxRef);
            }
          } else if (type === "done") {
            finalText = ((evt.text as string) ?? live).trim();
            const tIn = evt.tokens_in as number | undefined;
            const tOut = evt.tokens_out as number | undefined;
            const ms = evt.latency_ms as number | undefined;
            setSuggestInfo(
              `Done — ${(evt.model as string) || modelUsed || "model"}` +
                (tIn != null && tOut != null ? ` · ${tIn} in / ${tOut} out tokens` : "") +
                (ms != null ? ` · ${ms} ms` : ""),
            );
            if (finalText) setSuggestContent(finalText);
            break outer;
          } else if (type === "error") {
            throw new Error((evt.error as string) || "Suggest failed");
          }
        }
      }
    } catch (e) {
      const er = e as Error;
      if (er.name !== "AbortError" && !controller.signal.aborted) {
        setSuggestError(er.message);
      } else {
        setSuggestInfo("Stopped.");
      }
    } finally {
      if (suggestAbortRef.current === controller) suggestAbortRef.current = null;
      setSuggesting(false);
    }
  }

  function onSuggestOpen() {
    if (!providerId) {
      setErr("Pick a provider before suggesting.");
      return;
    }
    setErr(null);
    setSuggestOpen(true);
    void runSuggest();
  }

  function onStopSuggest() {
    suggestAbortRef.current?.abort();
  }

  function onSuggestDialogChange(next: boolean) {
    if (suggesting) return;
    setSuggestOpen(next);
    if (!next) {
      setSuggestReasoning("");
      setSuggestContent("");
      setSuggestInfo(null);
      setSuggestError(null);
    }
  }

  function applySuggestion() {
    const text = suggestContent.trim();
    if (!text) return;
    setPrompt(text);
    setSuggestOpen(false);
    setSuggestReasoning("");
    setSuggestContent("");
    setSuggestInfo(null);
    setSuggestError(null);
  }

  // If component unmounts mid-stream, abort the request.
  useEffect(() => {
    return () => suggestAbortRef.current?.abort();
  }, []);

  function toggleScope(k: keyof Scope) {
    setScope((s) => ({ ...s, [k]: !s[k] }));
  }

  function onProviderChange(id: string) {
    setProviderId(id);
    const p = providers.find((x) => x.id === id);
    setModel(p?.defaultModel ?? "");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const trimmed = prompt.trim();
    if (trimmed.length < 8) {
      setErr("Prompt must be at least 8 characters");
      return;
    }
    if (!providerId) {
      setErr("Pick a provider");
      return;
    }
    if (!Object.values(scope).some(Boolean)) {
      setErr("Pick at least one entity to generate");
      return;
    }
    // Sliders are clamped to valid ranges by their min/max, so no extra
    // validation is needed beyond the type — but we still bail defensively
    // if something pathological got into state.
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      setErr("Temperature must be between 0 and 2");
      return;
    }
    if (
      !Number.isInteger(maxTokens) ||
      maxTokens < 256 ||
      maxTokens > 64000
    ) {
      setErr("Max tokens must be an integer between 256 and 64000");
      return;
    }
    start(async () => {
      const res = await startBootstrap({
        projectId,
        prompt: trimmed,
        providerId,
        model: model || null,
        temperature,
        maxTokens,
        scope: {
          ...scope,
          useExistingToolsContext:
            existingToolsCount > 0 ? useToolsContext : false,
        },
      });
      if ("error" in res && res.error) {
        setErr(res.error);
        if ("runningJobId" in res && typeof res.runningJobId === "string") {
          router.push(`?jobId=${res.runningJobId}`);
        }
        return;
      }
      if ("ok" in res && res.ok) {
        router.push(`?jobId=${res.id}`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            One-prompt project bootstrap
          </CardTitle>
          <CardDescription>
            Describe what the project is for in plain English. The orchestrator
            will generate taxonomy nodes, language profiles, personas, prompt
            templates, tool defs, a flow, a rubric, and a default benchmark —
            in that order, all wired together. Items are <strong>added</strong>{" "}
            alongside whatever already exists; nothing is deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {existingToolsCount > 0 && (
            <label
              htmlFor="use-tools-context"
              className="flex cursor-pointer items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/5 p-3 hover:bg-blue-500/10"
            >
              <Checkbox
                id="use-tools-context"
                checked={useToolsContext}
                onCheckedChange={(v) => setUseToolsContext(v === true)}
                className="mt-0.5"
              />
              <span className="min-w-0 text-sm">
                <span className="block font-medium text-blue-900 dark:text-blue-200">
                  Bootstrap from my {existingToolsCount} existing tool
                  {existingToolsCount === 1 ? "" : "s"}
                </span>
                <span className="block text-[11px] text-blue-900/80 dark:text-blue-200/80">
                  When ON, Suggest invents a prompt that fits your tool catalog,
                  and taxonomy / personas / templates / flows are biased toward
                  referencing those tools. When OFF, bootstrap runs cold as if
                  the catalog didn't exist.
                </span>
              </span>
            </label>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt">Prompt</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPrompt(EXAMPLE_PROMPT)}
                  title="Fill the prompt with a sensible example"
                >
                  Use example
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onSuggestOpen}
                  disabled={pending || !providerId}
                  title={
                    useToolsContext && existingToolsCount > 0
                      ? `Generate a prompt that fits your ${existingToolsCount} existing tools`
                      : "Generate a random bootstrap prompt"
                  }
                >
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                  Suggest
                  {useToolsContext && existingToolsCount > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      (from {existingToolsCount} tools)
                    </span>
                  )}
                </Button>
              </div>
            </div>
            <Textarea
              id="prompt"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`e.g. ${EXAMPLE_PROMPT}`}
              className="font-normal"
            />
            <p className="text-[11px] text-muted-foreground">
              The more concrete the domain, locale, register, and topics you
              mention, the less drift across the generated entities.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                value={providerId}
                onChange={(e) => onProviderChange(e.target.value)}
                className="border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                {providers.length === 0 && (
                  <option value="">(no providers configured)</option>
                )}
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.defaultModel ? ` (${p.defaultModel})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model (override)</Label>
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="leave blank for default"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label
                htmlFor="temperature"
                className="flex items-center justify-between"
              >
                <span>Temperature</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {temperature.toFixed(2)}
                </span>
              </Label>
              <Slider
                id="temperature"
                min={0}
                max={2}
                step={0.05}
                value={[temperature]}
                onValueChange={(v) => setTemperature(v[0] ?? 0)}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>0 · deterministic</span>
                <span>1</span>
                <span>2 · chaotic</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="max-tokens"
                className="flex items-center justify-between"
              >
                <span>Max tokens per call</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {maxTokens.toLocaleString()}
                </span>
              </Label>
              <Slider
                id="max-tokens"
                min={256}
                max={32000}
                step={256}
                value={[maxTokens]}
                onValueChange={(v) => setMaxTokens(v[0] ?? 256)}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>256</span>
                <span>8k</span>
                <span>16k</span>
                <span>32k</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Generate</Label>
            {existingToolsCount > 0 && useToolsContext && (
              <div className="rounded-md border border-blue-500/40 bg-blue-500/5 px-3 py-2 text-[11px] text-blue-900 dark:text-blue-200">
                Using your <strong>{existingToolsCount}</strong> existing tool
                {existingToolsCount === 1 ? "" : "s"} as context for taxonomy /
                personas / templates / flows. The <strong>Tools</strong> phase
                is unchecked by default — leave it that way unless you want
                additional tools layered on top of your catalog.
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {SCOPE_ITEMS.map((item) => (
                <label
                  key={item.key}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background p-2.5 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={scope[item.key]}
                    onCheckedChange={() => toggleScope(item.key)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {item.label}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {item.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {err && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
              {err}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || providers.length === 0}>
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {pending ? "Starting…" : "Generate everything"}
        </Button>
      </div>

      <Dialog open={suggestOpen} onOpenChange={onSuggestDialogChange}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" />
              Suggest a bootstrap prompt
              {useToolsContext && existingToolsCount > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  · using {existingToolsCount} tools as context
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              Streaming from the selected provider. Accept the result to drop it
              into the Prompt field, or close to discard.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 flex-1 space-y-3 overflow-y-auto px-6 py-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Label>LLM output</Label>
                <ThroughputBadge
                  text={suggestContent + suggestReasoning}
                  startedAt={suggestStartedAt}
                  running={suggesting}
                />
              </div>
              {suggestInfo && (
                <span className="text-xs text-muted-foreground">
                  {suggestInfo}
                </span>
              )}
            </div>

            {(suggestReasoning || (suggesting && !suggestReasoning && !suggestContent)) && (
              <details open className="rounded-md border border-border bg-muted/20">
                <summary className="cursor-pointer select-none px-2 py-1 text-xs font-medium text-muted-foreground">
                  Reasoning ({suggestReasoning.length} chars)
                </summary>
                <pre
                  ref={suggestReasoningBoxRef}
                  className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2 py-2 font-mono text-[11px] italic text-muted-foreground"
                >
                  {suggestReasoning || "Waiting for first reasoning token…"}
                  {suggesting && !suggestContent && (
                    <span className="animate-pulse">▍</span>
                  )}
                </pre>
              </details>
            )}

            <pre
              ref={suggestContentBoxRef}
              className="max-h-72 min-h-[6rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-2 font-mono text-xs"
            >
              {suggestContent ||
                (suggesting
                  ? suggestReasoning
                    ? "Model is thinking… prompt will appear here."
                    : "Waiting for first token…"
                  : "(empty)")}
              {suggesting && suggestContent && (
                <span className="animate-pulse">▍</span>
              )}
            </pre>

            {suggestError && (
              <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {suggestError}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {suggesting ? (
              <Button
                type="button"
                variant="destructive"
                onClick={onStopSuggest}
              >
                <Square className="mr-1 h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onSuggestDialogChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={runSuggest}
                  disabled={!providerId}
                  title="Generate again"
                >
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                  Regenerate
                </Button>
                <Button
                  type="button"
                  onClick={applySuggestion}
                  disabled={!suggestContent.trim()}
                >
                  Use this prompt
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
