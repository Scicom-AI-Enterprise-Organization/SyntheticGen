"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import yaml from "js-yaml";
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
import { useConfirm } from "@/components/confirm-dialog";
import { autoLayout } from "./auto-layout";
import { coerceFlowGraph, type CoercedGraph } from "./flow-coerce";
import type { FlowEdge, FlowNode } from "./types";
import type { ToolOption } from "./tool-list-picker";

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string | null;
}

const EXAMPLE_PROMPT = `A TM modem outage triage flow:
- greet
- ask account number
- look up account + modem status (parallel)
- if outage in area → inform + offer ETA
- if modem offline → ask user to restart, check again
- if still broken → escalate to ticket`;

export function GenerateFlowDialog({
  projectId,
  providers,
  tools,
  onApply,
}: {
  projectId: string;
  providers: ProviderOption[];
  tools: ToolOption[];
  onApply: (nodes: FlowNode[], edges: FlowEdge[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [parsed, setParsed] = useState<CoercedGraph | null>(null);
  const [yamlPreview, setYamlPreview] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [randomizing, setRandomizing] = useState(false);
  const randomizeAbortRef = useRef<AbortController | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function reset() {
    setParsed(null);
    setYamlPreview("");
    setError(null);
    setInfo(null);
  }

  function toolCatalogContext(): string {
    const lines =
      tools.length === 0
        ? "(none configured)"
        : tools
            .map(
              (t) =>
                `- id: ${t.id}\n  name: ${t.name}${t.description ? `\n  desc: ${t.description.slice(0, 120)}` : ""}`,
            )
            .join("\n");
    return `AVAILABLE_TOOLS:\n${lines}`;
  }

  function onGenerate() {
    setError(null);
    setInfo(null);
    if (!prompt.trim()) {
      setError("Describe what the flow should do.");
      return;
    }
    if (!providerId) {
      setError("No provider configured. Add one under Providers.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/ai-assist`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "flow-graph",
            prompt,
            providerId,
            extraContext: toolCatalogContext(),
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `http ${res.status}`);
        }
        const json = (await res.json()) as { data: unknown };
        const validToolIds = new Set(tools.map((t) => t.id));
        const graph = coerceFlowGraph(json.data, { validToolIds, preservePositions: false });
        setParsed(graph);
        setYamlPreview(
          yaml.dump(
            { nodes: graph.nodes.map(({ id, type, data }) => ({ id, type, data })), edges: graph.edges },
            { indent: 2, lineWidth: 120 },
          ),
        );
        setInfo(
          graph.warnings.length > 0
            ? `Generated with ${graph.warnings.length} warning(s) — see preview.`
            : `Generated ${graph.nodes.length} nodes / ${graph.edges.length} edges.`,
        );
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function onRandomize() {
    setError(null);
    setInfo(null);
    if (!providerId) {
      setError("Pick a provider before randomizing.");
      return;
    }
    setRandomizing(true);
    setPrompt("");
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
            description:
              "Invent ONE concise prompt for an LLM to draft a conversation flow graph. Pick a realistic domain (Malaysian telco support, retail banking, hospital, ride-hailing, e-commerce returns, etc.). Sketch 5–10 steps in bullet form covering greeting, intent capture, tool lookups (parallel when independent), conditional branches on tool results, and an end state. Mention which AVAILABLE_TOOLS might apply. ONE short prompt — used as input to a downstream form-filling LLM.",
            extraContext: toolCatalogContext(),
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
      let liveContent = "";
      let finalText: string | null = null;

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
          try { evt = JSON.parse(trimmed); } catch { continue; }
          const type = evt.type as string;
          if (type === "delta") {
            if (!evt.reasoning) {
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
      if (err.name !== "AbortError" && !controller.signal.aborted) {
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

  async function onApplyClick() {
    if (!parsed) return;
    const ok = await confirm({
      title: "Replace the current flow?",
      body: "Existing nodes and edges are wiped from the canvas. The DB version stays intact until you click Save — discard by navigating away if you change your mind.",
      confirmText: "Apply to canvas",
      destructive: true,
    });
    if (!ok) return;
    const laid = autoLayout(parsed.nodes, parsed.edges);
    onApply(laid, parsed.edges);
    setOpen(false);
    setPrompt("");
    reset();
  }

  if (providers.length === 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        title="Add a Provider under the Providers tab to enable AI-assist"
      >
        <Sparkles className="mr-2 h-4 w-4" />
        Generate from prompt
      </Button>
    );
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Sparkles className="mr-2 h-4 w-4" />
        Generate from prompt
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Generate flow from prompt
            </DialogTitle>
            <DialogDescription>
              Describe the conversation flow in plain English. The LLM will return a graph; review
              the YAML below before applying. Tool IDs are validated against this project&apos;s
              catalog ({tools.length} tool{tools.length === 1 ? "" : "s"} available).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="gf-prompt">Prompt</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPrompt(EXAMPLE_PROMPT)}
                    disabled={pending || randomizing}
                    title="Fill with an example flow prompt"
                  >
                    Use example
                  </Button>
                  {randomizing ? (
                    <Button type="button" variant="destructive" size="sm" onClick={onStopRandomize}>
                      Stop
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onRandomize}
                      disabled={pending}
                      title="Ask the LLM to invent a flow prompt"
                    >
                      Randomize
                    </Button>
                  )}
                </div>
              </div>
              <Textarea
                id="gf-prompt"
                rows={6}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={EXAMPLE_PROMPT}
                disabled={pending || randomizing}
              />
              {randomizing && (
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Streaming prompt…
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="gf-provider">Provider</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger id="gf-provider">
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

            {parsed && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Preview</Label>
                  <span className="text-[11px] text-muted-foreground">
                    {parsed.nodes.length} node{parsed.nodes.length === 1 ? "" : "s"} ·{" "}
                    {parsed.edges.length} edge{parsed.edges.length === 1 ? "" : "s"}
                  </span>
                </div>
                {parsed.warnings.length > 0 && (
                  <ul className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                    {parsed.warnings.slice(0, 5).map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                    {parsed.warnings.length > 5 && (
                      <li>• … +{parsed.warnings.length - 5} more</li>
                    )}
                  </ul>
                )}
                <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-snug">
                  {yamlPreview}
                </pre>
              </div>
            )}
          </div>

          {error && (
            <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {info && !error && <p className="text-xs text-muted-foreground">{info}</p>}

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="outline" onClick={onGenerate} disabled={pending || randomizing}>
              {pending ? "Generating…" : parsed ? "Regenerate" : "Generate"}
            </Button>
            <Button onClick={onApplyClick} disabled={!parsed || pending}>
              Apply to canvas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
