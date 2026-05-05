"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Node, Edge } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ToolListPicker, type ToolOption } from "./tool-list-picker";

interface InspectorProps {
  selectedNode: Node | null;
  selectedEdge: Edge | null;
  tools: ToolOption[];
  canWrite: boolean;
  onUpdateNode: (nodeId: string, patch: Record<string, unknown>) => void;
  onDeleteNode: (nodeId: string) => void;
  onUpdateEdge: (edgeId: string, label: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

export function NodeInspector(props: InspectorProps) {
  const { selectedNode, selectedEdge, canWrite } = props;

  if (selectedEdge) {
    return <EdgeInspector {...props} edge={selectedEdge} />;
  }
  if (!selectedNode) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Select a node or edge to edit its details. Drag from the palette to add new nodes; drag
        from the right handle to wire them up.
      </div>
    );
  }
  return <NodeFields {...props} node={selectedNode} />;
}

function EdgeInspector({
  edge,
  canWrite,
  onUpdateEdge,
  onDeleteEdge,
}: InspectorProps & { edge: Edge }) {
  const [label, setLabel] = useState(typeof edge.label === "string" ? edge.label : "");
  const confirm = useConfirm();

  useEffect(() => {
    setLabel(typeof edge.label === "string" ? edge.label : "");
  }, [edge.id, edge.label]);

  function onBlur() {
    if ((edge.label ?? "") !== label) onUpdateEdge(edge.id, label);
  }

  return (
    <div className="space-y-3 p-4 text-xs">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Edge
        </div>
        <div className="mt-1 font-mono text-[11px]">
          {edge.source} → {edge.target}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edge-label" className="text-xs">
          Label / condition
        </Label>
        <Input
          id="edge-label"
          value={label}
          disabled={!canWrite}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={onBlur}
          placeholder='e.g. "tool.success" or "user_confirms"'
        />
        <p className="text-[10px] text-muted-foreground">
          Free-text. The worker uses this to label which path was taken; later slices will parse it
          as an expression.
        </p>
      </div>
      {canWrite && (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const ok = await confirm({
              title: "Delete this edge?",
              destructive: true,
            });
            if (ok) onDeleteEdge(edge.id);
          }}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete edge
        </Button>
      )}
    </div>
  );
}

function NodeFields({
  node,
  tools,
  canWrite,
  onUpdateNode,
  onDeleteNode,
}: InspectorProps & { node: Node }) {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const isStart = node.type === "start";
  const isEnd = node.type === "end";
  const confirm = useConfirm();

  return (
    <div className="space-y-3 p-4 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {node.type ?? "node"}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{node.id}</div>
        </div>
        {canWrite && !isStart && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete node"
            onClick={async () => {
              const ok = await confirm({
                title: "Delete this node?",
                body: "Connected edges are removed too.",
                destructive: true,
              });
              if (ok) onDeleteNode(node.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Field label="Label" disabled={!canWrite}>
        <Input
          value={asString(data.label)}
          disabled={!canWrite}
          onChange={(e) => onUpdateNode(node.id, { label: e.target.value })}
          placeholder={isStart ? "Start" : isEnd ? "End" : "Short title"}
        />
      </Field>

      {!isStart && !isEnd && (
        <Field label="Description" disabled={!canWrite}>
          <Textarea
            rows={3}
            value={asString(data.description)}
            disabled={!canWrite}
            onChange={(e) => onUpdateNode(node.id, { description: e.target.value })}
            placeholder={
              node.type === "intent"
                ? "What user need or question does this node represent?"
                : "What should the assistant do at this turn?"
            }
          />
        </Field>
      )}

      {node.type === "action" && (
        <ToolListPicker
          available={tools}
          selected={
            Array.isArray(data.toolIds)
              ? (data.toolIds as unknown[]).filter((x): x is string => typeof x === "string")
              : []
          }
          mode={data.toolMode === "parallel" ? "parallel" : "sequential"}
          disabled={!canWrite}
          onChange={(next) => onUpdateNode(node.id, { toolIds: next })}
          onModeChange={(m) => onUpdateNode(node.id, { toolMode: m })}
        />
      )}

      {node.type === "intent" && (
        <Field label="Example utterances (one per line)" disabled={!canWrite}>
          <Textarea
            rows={5}
            value={
              Array.isArray(data.examples)
                ? (data.examples as unknown[]).filter((x) => typeof x === "string").join("\n")
                : ""
            }
            disabled={!canWrite}
            onChange={(e) =>
              onUpdateNode(node.id, {
                examples: e.target.value
                  .split(/\n+/)
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
            placeholder={"Internet saya tak boleh connect.\nBoleh check status modem saya?"}
          />
        </Field>
      )}

      {node.type === "condition" && (
        <Field label="Expression" disabled={!canWrite}>
          <Input
            value={asString(data.expression)}
            disabled={!canWrite}
            onChange={(e) => onUpdateNode(node.id, { expression: e.target.value })}
            placeholder='e.g. "tool.status == healthy"'
          />
        </Field>
      )}

      {node.type === "end" && (
        <Field label="Outcome" disabled={!canWrite}>
          <Select
            value={asString(data.outcome) || "resolved"}
            onValueChange={(v) => onUpdateNode(node.id, { outcome: v })}
            disabled={!canWrite}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="resolved">resolved</SelectItem>
              <SelectItem value="escalated">escalated</SelectItem>
              <SelectItem value="abandoned">abandoned</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}

function Field({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className={disabled ? "text-xs text-muted-foreground" : "text-xs"}>{label}</Label>
      {children}
    </div>
  );
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
