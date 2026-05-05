"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [reasoningText, setReasoningText] = useState("");
  const [contentText, setContentText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reasoningBoxRef = useRef<HTMLPreElement | null>(null);
  const contentBoxRef = useRef<HTMLPreElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function autoScroll(ref: React.RefObject<HTMLPreElement | null>) {
    queueMicrotask(() => {
      const el = ref.current;
      if (el) el.scrollTop = el.scrollHeight;
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
    const controller = new AbortController();
    abortRef.current = controller;
    start(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/ai-assist?stream=1`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, prompt, providerId, extraContext }),
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {buttonLabel}
            </DialogTitle>
            <DialogDescription>
              Describe what you want and the LLM will fill the form. Review the values before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-prompt">Prompt</Label>
                {placeholder && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPrompt(placeholder)}
                    disabled={pending}
                    title="Fill the prompt with a sensible example"
                  >
                    Use example
                  </Button>
                )}
              </div>
              <Textarea
                id="ai-prompt"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={placeholder ?? "Describe what you want…"}
                disabled={pending}
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

            {(pending || reasoningText || contentText) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>LLM output</Label>
                  {info && <span className="text-xs text-muted-foreground">{info}</span>}
                </div>

                {reasoningText && (
                  <details open className="rounded-md border border-border bg-muted/20">
                    <summary className="cursor-pointer select-none px-2 py-1 text-xs font-medium text-muted-foreground">
                      Reasoning ({reasoningText.length} chars)
                    </summary>
                    <pre
                      ref={reasoningBoxRef}
                      className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2 py-2 font-mono text-[11px] italic text-muted-foreground"
                    >
                      {reasoningText}
                      {pending && !contentText && <span className="animate-pulse">▍</span>}
                    </pre>
                  </details>
                )}

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
            <Button onClick={onRun} disabled={pending}>
              {pending ? "Generating…" : "Fill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
