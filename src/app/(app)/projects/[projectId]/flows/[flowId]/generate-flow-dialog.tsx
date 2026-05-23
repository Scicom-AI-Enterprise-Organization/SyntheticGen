"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import yaml from "js-yaml";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
import { Slider } from "@/components/ui/slider";
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
import { NODE_TYPES } from "./flow-nodes";
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
  const [maxTokens, setMaxTokens] = useState<number>(16000);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [parsed, setParsed] = useState<CoercedGraph | null>(null);
  const [yamlPreview, setYamlPreview] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [randomizing, setRandomizing] = useState(false);
  const randomizeAbortRef = useRef<AbortController | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  // Live token panels shared by both Generate and Randomize. Reasoning models
  // (Qwen3-thinking etc.) emit a long reasoning trace before any content; we
  // stream both so the user knows the LLM is working.
  const [streamReasoning, setStreamReasoning] = useState("");
  const [streamContent, setStreamContent] = useState("");
  const [streamStage, setStreamStage] = useState<"idle" | "generate" | "randomize">("idle");
  const reasoningBoxRef = useRef<HTMLPreElement | null>(null);
  const contentBoxRef = useRef<HTMLPreElement | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function autoScroll(ref: React.RefObject<HTMLPreElement | null>) {
    queueMicrotask(() => {
      const el = ref.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function resetStream() {
    setStreamReasoning("");
    setStreamContent("");
    setStreamStage("idle");
  }

  function reset() {
    setParsed(null);
    setYamlPreview("");
    setError(null);
    setInfo(null);
    resetStream();
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
    setStreamReasoning("");
    setStreamContent("");
    setStreamStage("generate");
    const controller = new AbortController();
    generateAbortRef.current = controller;
    start(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/ai-assist?stream=1`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "flow-graph",
            prompt,
            providerId,
            extraContext: toolCatalogContext(),
            maxTokens,
            temperature,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `http ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalData: unknown = null;
        let liveReasoning = "";
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
            try { evt = JSON.parse(trimmed); } catch { continue; }
            const type = evt.type as string;
            if (type === "delta") {
              const t = (evt.text as string) ?? "";
              if (evt.reasoning) {
                liveReasoning += t;
                setStreamReasoning(liveReasoning);
                autoScroll(reasoningBoxRef);
              } else {
                liveContent += t;
                setStreamContent(liveContent);
                autoScroll(contentBoxRef);
              }
            } else if (type === "done") {
              finalData = (evt.data as unknown) ?? null;
              break outer;
            } else if (type === "error") {
              const raw = evt.raw as string | undefined;
              throw new Error(
                (evt.error as string) + (raw ? `\n\n--- raw ---\n${raw}` : ""),
              );
            }
          }
        }
        if (!finalData) throw new Error("Stream ended without a done event");
        const validToolIds = new Set(tools.map((t) => t.id));
        const graph = coerceFlowGraph(finalData, { validToolIds, preservePositions: false });
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
        const err = e as Error;
        if (err.name !== "AbortError" && !controller.signal.aborted) {
          setError(err.message);
        }
      } finally {
        if (generateAbortRef.current === controller) generateAbortRef.current = null;
        setStreamStage("idle");
      }
    });
  }

  function onStopGenerate() {
    generateAbortRef.current?.abort();
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
    setStreamReasoning("");
    setStreamContent("");
    setStreamStage("randomize");
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
            const t = (evt.text as string) ?? "";
            if (evt.reasoning) {
              setStreamReasoning((prev) => {
                const next = prev + t;
                autoScroll(reasoningBoxRef);
                return next;
              });
            } else {
              liveContent += t;
              setPrompt(liveContent);
              setStreamContent(liveContent);
              autoScroll(contentBoxRef);
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
      setStreamStage("idle");
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
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Generate flow from prompt
            </DialogTitle>
            <DialogDescription>
              Describe the conversation flow in plain English. Review the visual
              preview + YAML below before applying. Tool IDs are validated against
              this project&apos;s catalog ({tools.length} tool{tools.length === 1 ? "" : "s"} available).
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 flex-1 space-y-3 overflow-y-auto px-6 py-1">
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

            {(streamStage !== "idle" || streamReasoning || streamContent) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>
                    {streamStage === "generate"
                      ? "Graph stream"
                      : streamStage === "randomize"
                        ? "Randomize stream"
                        : "LLM output"}
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    reasoning {streamReasoning.length.toLocaleString()} chars ·{" "}
                    content {streamContent.length.toLocaleString()} chars
                  </span>
                </div>
                {streamStage !== "idle" && !streamReasoning && !streamContent && (
                  <p className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-[11px] text-blue-700 dark:text-blue-300">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {streamStage === "generate"
                      ? "Asking the model for the flow graph… first token can take a few seconds for reasoning models."
                      : "Asking the model for a prompt…"}
                  </p>
                )}
                {(streamReasoning || streamStage !== "idle") && (
                  <details open className="rounded-md border border-border bg-muted/20">
                    <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      Reasoning ({streamReasoning.length.toLocaleString()} chars)
                    </summary>
                    <pre
                      ref={reasoningBoxRef}
                      className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2 py-2 font-mono text-[10px] italic text-muted-foreground"
                    >
                      {streamReasoning || "Waiting for first reasoning token…"}
                      {streamStage !== "idle" && !streamContent && (
                        <span className="animate-pulse">▍</span>
                      )}
                    </pre>
                  </details>
                )}
                {streamStage === "generate" && (
                  <pre
                    ref={contentBoxRef}
                    className="max-h-60 min-h-[5rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px]"
                  >
                    {streamContent ||
                      (streamReasoning
                        ? "Model is thinking… JSON will appear here."
                        : "Waiting for first token…")}
                    {streamStage === "generate" && streamContent && (
                      <span className="animate-pulse">▍</span>
                    )}
                  </pre>
                )}
              </div>
            )}

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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="gf-max-tokens">Max output tokens</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {maxTokens.toLocaleString()}
                </span>
              </div>
              <Slider
                id="gf-max-tokens"
                min={1000}
                max={64000}
                step={500}
                value={[maxTokens]}
                onValueChange={([v]) => setMaxTokens(v ?? 1000)}
                disabled={pending || randomizing}
              />
              <p className="text-xs text-muted-foreground">
                Reasoning models (Qwen3-thinking, DeepSeek-R1) burn lots of tokens
                on chain-of-thought before producing the graph JSON — keep this
                generous so the answer doesn&apos;t truncate.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="gf-temp">Temperature</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {temperature.toFixed(2)}
                </span>
              </div>
              <Slider
                id="gf-temp"
                min={0}
                max={2}
                step={0.05}
                value={[temperature]}
                onValueChange={([v]) => setTemperature(v ?? 0)}
                disabled={pending || randomizing}
              />
              <p className="text-xs text-muted-foreground">
                0 = deterministic (often repeats), 0.7 = balanced default,
                ≥1.0 = creative variety. Bump higher if the model keeps spitting
                the same nodes; drop lower if it goes off-spec.
              </p>
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

                <GraphPreview parsed={parsed} />

                <details className="rounded-md border border-border bg-muted/40">
                  <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    YAML ({yamlPreview.length.toLocaleString()} chars)
                  </summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2 py-2 font-mono text-[11px] leading-snug">
                    {yamlPreview}
                  </pre>
                </details>
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
            {pending ? (
              <Button type="button" variant="destructive" onClick={onStopGenerate}>
                Stop generation
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onGenerate}
              disabled={pending || randomizing}
            >
              {pending ? "Generating…" : parsed ? "Regenerate" : "Generate"}
            </Button>
            <Button type="button" onClick={onApplyClick} disabled={!parsed || pending}>
              Apply to canvas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Read-only mini ReactFlow preview of the generated graph. We auto-layout the
// nodes (BFS-layered, left-to-right) and adapt them to the same NODE_TYPES the
// editor uses so styling matches what the user will see after Apply.
function GraphPreview({ parsed }: { parsed: CoercedGraph }) {
  const { nodes, edges } = useMemo(() => {
    const laid = autoLayout(parsed.nodes, parsed.edges);
    const rfNodes: RFNode[] = laid.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data as unknown as Record<string, unknown>,
    }));
    const rfEdges: RFEdge[] = parsed.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      data: e.data as unknown as Record<string, unknown> | undefined,
    }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [parsed]);

  return (
    <div className="h-80 w-full overflow-hidden rounded-md border border-border bg-muted/20">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable={false}
          edgesReconnectable={false}
          panOnScroll
          zoomOnScroll={false}
          panOnDrag
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
