"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Clipboard, FileCode, Upload } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/confirm-dialog";
import { autoLayout } from "./auto-layout";
import { coerceFlowGraph, toExportShape } from "./flow-coerce";
import type { ToolOption } from "./tool-list-picker";
import type { FlowEdge, FlowNode } from "./types";

interface Props {
  nodes: FlowNode[];
  edges: FlowEdge[];
  tools: ToolOption[];
  canWrite: boolean;
  onApply: (nodes: FlowNode[], edges: FlowEdge[]) => void;
}

export function YamlDialog({ nodes, edges, tools, canWrite, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"export" | "import">("export");
  const [pasteText, setPasteText] = useState("");
  const [pendingApply, startApply] = useTransition();
  const confirm = useConfirm();
  const [copied, setCopied] = useState(false);

  // Re-serialize on dialog open so the export reflects the latest canvas.
  const exportYaml = useMemo(() => {
    if (!open) return "";
    return yaml.dump(toExportShape(nodes, edges), { indent: 2, lineWidth: 120 });
  }, [open, nodes, edges]);

  useEffect(() => {
    if (!open) {
      setPasteText("");
      setCopied(false);
    }
  }, [open]);

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportYaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Copied YAML to clipboard");
    } catch {
      toast.error("Clipboard not available — select-all and copy manually.");
    }
  }

  async function applyImport() {
    if (!pasteText.trim()) {
      toast.error("Paste a YAML graph first.");
      return;
    }
    // Parse + validate up front so the confirm dialog can show real counts.
    let parsedYaml: unknown;
    try {
      parsedYaml = yaml.load(pasteText);
    } catch (e) {
      toast.error(`YAML parse error: ${(e as Error).message}`);
      return;
    }
    let coerced;
    try {
      coerced = coerceFlowGraph(parsedYaml, {
        validToolIds: new Set(tools.map((t) => t.id)),
        preservePositions: true,
      });
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    const anyHasPosition = coerced.nodes.some(
      (n) => n.position.x !== 0 || n.position.y !== 0,
    );
    const finalNodes = anyHasPosition
      ? coerced.nodes
      : autoLayout(coerced.nodes, coerced.edges);

    const ok = await confirm({
      title: "Replace the current flow?",
      body: `Importing ${coerced.nodes.length} nodes / ${coerced.edges.length} edges. The DB version stays intact until you Save.`,
      confirmText: "Apply to canvas",
      destructive: true,
    });
    if (!ok) return;

    startApply(() => {
      onApply(finalNodes, coerced.edges);
      setOpen(false);
      if (coerced.warnings.length > 0) {
        toast.warning(`Imported with ${coerced.warnings.length} warning(s).`);
      } else {
        toast.success("Imported — click Save to persist.");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileCode className="mr-2 h-4 w-4" />
        YAML
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>YAML</DialogTitle>
            <DialogDescription>
              Round-trip the flow as YAML. Export to share or version-control. Import to replace the
              current canvas with a pasted graph.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "export" | "import")}>
            <TabsList>
              <TabsTrigger value="export">Export</TabsTrigger>
              <TabsTrigger value="import" disabled={!canWrite}>
                Import
              </TabsTrigger>
            </TabsList>

            <TabsContent value="export" className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  Current canvas — {nodes.length} node{nodes.length === 1 ? "" : "s"} ·{" "}
                  {edges.length} edge{edges.length === 1 ? "" : "s"}
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyExport}
                  disabled={!exportYaml}
                >
                  {copied ? (
                    <>
                      <Check className="mr-2 h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Clipboard className="mr-2 h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </Button>
              </div>
              <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-snug">
                {exportYaml || "(empty)"}
              </pre>
              <p className="text-[10px] text-muted-foreground">
                Positions are included so the layout round-trips. Drop them from the YAML if you
                want auto-layout on import.
              </p>
            </TabsContent>

            <TabsContent value="import" className="space-y-2">
              <Label htmlFor="yaml-paste" className="text-xs">
                Paste YAML
              </Label>
              <Textarea
                id="yaml-paste"
                rows={14}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                className="font-mono text-[11px]"
                placeholder={`nodes:
  - id: start
    type: start
    data:
      label: Start
  - id: intent_outage
    type: intent
    data:
      label: Outage complaint
      examples:
        - "Modem saya tak boleh connect"
edges:
  - id: e1
    source: start
    target: intent_outage`}
                disabled={!canWrite}
              />
              <p className="text-[10px] text-muted-foreground">
                Tool IDs are validated against this project&apos;s catalog. Positions in the YAML are
                preserved if present; otherwise the canvas is auto-laid-out.
              </p>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            {tab === "import" && canWrite && (
              <Button onClick={applyImport} disabled={pendingApply}>
                <Upload className="mr-2 h-3.5 w-3.5" />
                {pendingApply ? "Applying…" : "Apply to canvas"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
