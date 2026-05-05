"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
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
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function reset() {
    setParsed(null);
    setYamlPreview("");
  }

  function onGenerate() {
    if (!prompt.trim()) {
      toast.error("Describe what the flow should do.");
      return;
    }
    if (!providerId) {
      toast.error("No provider configured. Add one under Providers.");
      return;
    }
    start(async () => {
      try {
        // Tell the LLM exactly which tool IDs are available so action.toolIds
        // stays in-bounds. Names + descriptions help it pick relevant ones.
        const toolCatalog =
          tools.length === 0
            ? "(none configured)"
            : tools
                .map(
                  (t) =>
                    `- id: ${t.id}\n  name: ${t.name}${t.description ? `\n  desc: ${t.description.slice(0, 120)}` : ""}`,
                )
                .join("\n");
        const extraContext = `AVAILABLE_TOOLS:\n${toolCatalog}`;

        const res = await fetch(`/api/projects/${projectId}/ai-assist`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "flow-graph",
            prompt,
            providerId,
            extraContext,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `http ${res.status}`);
        }
        const json = (await res.json()) as { data: unknown };
        const validToolIds = new Set(tools.map((t) => t.id));
        // AI-generated graphs never carry positions — auto-layout owns that.
        const graph = coerceFlowGraph(json.data, { validToolIds, preservePositions: false });
        setParsed(graph);
        setYamlPreview(
          yaml.dump(
            { nodes: graph.nodes.map(({ id, type, data }) => ({ id, type, data })), edges: graph.edges },
            { indent: 2, lineWidth: 120 },
          ),
        );
        if (graph.warnings.length > 0) {
          toast.warning(`Generated with ${graph.warnings.length} warning(s) — see preview.`);
        } else {
          toast.success(`Generated ${graph.nodes.length} nodes / ${graph.edges.length} edges.`);
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
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
    toast.success("Applied — click Save to persist.");
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
              <Label htmlFor="gf-prompt">Prompt</Label>
              <Textarea
                id="gf-prompt"
                rows={6}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`A TM modem outage triage flow:
- greet
- ask account number
- look up account + modem status (parallel)
- if outage in area → inform + offer ETA
- if modem offline → ask user to restart, check again
- if still broken → escalate to ticket`}
                disabled={pending}
              />
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

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="outline" onClick={onGenerate} disabled={pending}>
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
