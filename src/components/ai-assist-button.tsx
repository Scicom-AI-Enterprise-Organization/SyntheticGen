"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThroughputBadge } from "@/components/throughput-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AiAssistKind } from "@/lib/synthgen-api";

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string | null;
}

export function AiAssistButton({
  projectId,
  kind,
  providers,
  placeholder,
  onApply,
  variant = "outline",
  size = "sm",
  buttonLabel = "Fill with AI",
  extraContext,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  randomizePrompt,
}: {
  projectId: string;
  kind: AiAssistKind;
  providers: ProviderOption[];
  placeholder?: string;
  onApply: (data: Record<string, unknown>) => void;
  variant?: "outline" | "default" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  buttonLabel?: string;
  extraContext?: string | null;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /** When provided, a "Randomize" button appears next to "Use example".
   *  Clicking it asks the currently-selected provider to generate a one-sentence
   *  prompt using `description` as the system hint and `context` as optional
   *  extra information (e.g. the project's taxonomy node names). The returned
   *  text is dropped into the prompt textarea. */
  randomizePrompt?: {
    description: string;
    context?: string | null;
  };
}) {
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? Boolean(openProp) : openInternal;
  const setOpen = (next: boolean) => {
    if (!isControlled) setOpenInternal(next);
    onOpenChangeProp?.(next);
  };
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [maxTokens, setMaxTokens] = useState<number>(8000);
  const [randomizing, setRandomizing] = useState(false);
  const randomizeAbortRef = useRef<AbortController | null>(null);
  const [reasoningText, setReasoningText] = useState("");
  const [contentText, setContentText] = useState("");
  // Stamp at start of run/randomize so the throughput meter can compute a
  // live tokens-per-second figure. Cleared between calls.
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reasoningBoxRef = useRef<HTMLPreElement | null>(null);
  const contentBoxRef = useRef<HTMLPreElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sticky-to-bottom: only snap if the user is currently within ~64px of
  // the bottom. If they've scrolled up to read older tokens, leave them
  // alone instead of yanking back on every delta.
  function autoScroll(ref: React.RefObject<HTMLPreElement | null>) {
    queueMicrotask(() => {
      const el = ref.current;
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance <= 64) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  function appendDelta(chunk: string, reasoning: boolean) {
    if (reasoning) {
      setReasoningText((t) => t + chunk);
      autoScroll(reasoningBoxRef);
    } else {
      setContentText((t) => t + chunk);
      autoScroll(contentBoxRef);
    }
  }

  function onRun() {
    setError(null);
    setInfo(null);
    if (!prompt.trim()) {
      setError("Describe what you want first.");
      return;
    }
    if (!providerId) {
      setError("No provider configured. Add one under Providers.");
      return;
    }
    setReasoningText("");
    setContentText("");
    setStreamStartedAt(Date.now());
    const controller = new AbortController();
    abortRef.current = controller;
    start(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/ai-assist?stream=1`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, prompt, providerId, extraContext, maxTokens }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `http ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let appliedData: Record<string, unknown> | null = null;
        let modelUsed = "";

        outer: while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(trimmed);
            } catch {
              continue;
            }
            const type = evt.type as string;
            if (type === "start") {
              modelUsed = (evt.model as string) ?? "";
              if (modelUsed) setInfo(`Streaming from ${modelUsed}…`);
            } else if (type === "delta") {
              appendDelta((evt.text as string) ?? "", Boolean(evt.reasoning));
            } else if (type === "done") {
              appliedData = (evt.data as Record<string, unknown>) ?? {};
              const tIn = evt.tokens_in as number | undefined;
              const tOut = evt.tokens_out as number | undefined;
              const ms = evt.latency_ms as number | undefined;
              setInfo(
                `Done — ${(evt.model as string) || modelUsed || "model"}` +
                  (tIn != null && tOut != null ? ` · ${tIn} in / ${tOut} out tokens` : "") +
                  (ms != null ? ` · ${ms} ms` : ""),
              );
              break outer;
            } else if (type === "error") {
              const raw = evt.raw as string | undefined;
              throw new Error(
                (evt.error as string) + (raw ? `\n\n--- raw output ---\n${raw}` : ""),
              );
            }
          }
        }

        if (!appliedData) {
          throw new Error("stream ended before a done event was received");
        }
        onApply(appliedData);
        setPrompt("");
        setReasoningText("");
        setContentText("");
        setOpen(false);
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError" || controller.signal.aborted) {
          setInfo("Stopped.");
        } else {
          setError(err.message);
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    });
  }

  function onStop() {
    abortRef.current?.abort();
  }

  async function onRandomize() {
    if (!randomizePrompt) return;
    if (!providerId) {
      setError("Pick a provider before randomizing.");
      return;
    }
    setError(null);
    setRandomizing(true);
    setPrompt("");
    setReasoningText("");
    setContentText("");
    setStreamStartedAt(Date.now());
    setInfo(null);
    const controller = new AbortController();
    randomizeAbortRef.current = controller;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/random-prompt?stream=1`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerId,
            description: randomizePrompt.description,
            extraContext: randomizePrompt.context ?? null,
            maxTokens,
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
      let finalText: string | null = null;
      let liveContent = "";

      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(trimmed);
          } catch {
            continue;
          }
          const type = evt.type as string;
          if (type === "start") {
            const modelUsed = (evt.model as string) ?? "";
            if (modelUsed) setInfo(`Streaming from ${modelUsed}…`);
          } else if (type === "delta") {
            if (evt.reasoning) {
              setReasoningText((t) => t + ((evt.text as string) ?? ""));
              autoScroll(reasoningBoxRef);
            } else {
              liveContent += (evt.text as string) ?? "";
              setPrompt(liveContent);
            }
          } else if (type === "done") {
            finalText = (evt.text as string) ?? liveContent;
            break outer;
          } else if (type === "error") {
            throw new Error((evt.error as string) || "Randomize failed");
          }
        }
      }

      if (finalText) setPrompt(finalText.trim());
      else if (!liveContent) throw new Error("Randomize returned an empty prompt.");
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError" || controller.signal.aborted) {
        // Stopped — keep whatever already streamed in.
      } else {
        setError(err.message);
      }
    } finally {
      if (randomizeAbortRef.current === controller) randomizeAbortRef.current = null;
      setRandomizing(false);
    }
  }

  function onStopRandomize() {
    randomizeAbortRef.current?.abort();
  }

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setError(null);
      setInfo(null);
      setReasoningText("");
      setContentText("");
    }
  }

  if (providers.length === 0) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled
        title="Add a Provider under the Providers tab to enable AI-assist"
      >
        <Sparkles className="mr-2 h-4 w-4" />
        {buttonLabel}
      </Button>
    );
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        <Sparkles className="mr-2 h-4 w-4" />
        {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {buttonLabel}
            </DialogTitle>
            <DialogDescription>
              Describe what you want and the LLM will fill the form. Review the values before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 flex-1 space-y-3 overflow-y-auto px-6 py-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-prompt">Prompt</Label>
                <div className="flex gap-1">
                  {placeholder && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPrompt(placeholder)}
                      disabled={pending || randomizing}
                      title="Fill the prompt with a sensible example"
                    >
                      Use example
                    </Button>
                  )}
                  {randomizePrompt && (
                    randomizing ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={onStopRandomize}
                        title="Stop the LLM"
                      >
                        Stop
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onRandomize}
                        disabled={pending}
                        title="Ask the LLM to invent a random prompt"
                      >
                        Randomize
                      </Button>
                    )
                  )}
                </div>
              </div>
              <Textarea
                id="ai-prompt"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={placeholder ?? "Describe what you want…"}
                disabled={pending || randomizing}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select value={providerId} onValueChange={setProviderId} disabled={pending}>
                <SelectTrigger id="ai-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.defaultModel && (
                        <span className="ml-1 text-muted-foreground">({p.defaultModel})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-max-tokens">Max output tokens</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {maxTokens.toLocaleString()}
                </span>
              </div>
              <input
                id="ai-max-tokens"
                type="range"
                min={1000}
                max={32000}
                step={500}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                disabled={pending}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                Caps how many tokens the model can generate (reasoning + answer).
                Reasoning models like Qwen3-thinking eat thousands of tokens before
                producing JSON — keep it generous when in doubt.
              </p>
            </div>

            {(pending || randomizing || reasoningText || contentText) && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Label>{randomizing ? "Randomize output" : "LLM output"}</Label>
                    <ThroughputBadge
                      text={contentText + reasoningText}
                      startedAt={streamStartedAt}
                      running={pending || randomizing}
                    />
                  </div>
                  {info && <span className="text-xs text-muted-foreground">{info}</span>}
                </div>

                {(reasoningText || (randomizing && !reasoningText)) && (
                  <details open className="rounded-md border border-border bg-muted/20">
                    <summary className="cursor-pointer select-none px-2 py-1 text-xs font-medium text-muted-foreground">
                      Reasoning ({reasoningText.length} chars)
                    </summary>
                    <pre
                      ref={reasoningBoxRef}
                      className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2 py-2 font-mono text-[11px] italic text-muted-foreground"
                    >
                      {reasoningText || "Waiting for first reasoning token…"}
                      {(pending || randomizing) && !contentText && (
                        <span className="animate-pulse">▍</span>
                      )}
                    </pre>
                  </details>
                )}

                {!randomizing && (
                  <pre
                    ref={contentBoxRef}
                    className="max-h-72 min-h-[6rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-2 font-mono text-xs"
                  >
                    {contentText ||
                      (reasoningText
                        ? "Model is thinking… answer will appear here."
                        : "Waiting for first token…")}
                    {pending && contentText && <span className="animate-pulse">▍</span>}
                  </pre>
                )}
              </div>
            )}

            {error && (
              <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            {pending ? (
              <Button variant="destructive" onClick={onStop}>
                Stop
              </Button>
            ) : (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            )}
            <Button onClick={onRun} disabled={pending || randomizing}>
              {pending ? "Generating…" : randomizing ? "Randomizing…" : "Fill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
