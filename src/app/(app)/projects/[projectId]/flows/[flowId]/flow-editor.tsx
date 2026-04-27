"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Flag,
  GitMerge,
  MessageSquare,
  Save,
  Square,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NODE_TYPES } from "./flow-nodes";
import { NodeInspector } from "./node-inspector";
import { GenerateFlowDialog } from "./generate-flow-dialog";
import { YamlDialog } from "./yaml-dialog";
import { saveFlow } from "../actions";
import type { ToolOption } from "./tool-list-picker";
import type { FlowEdge, FlowNode, FlowNodeKind } from "./types";

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string | null;
}

interface FlowProp {
  id: string;
  name: string;
  description: string | null;
  isPublished: boolean;
  version: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const PALETTE: { kind: Exclude<FlowNodeKind, "start">; label: string; icon: React.ElementType }[] = [
  { kind: "intent", label: "Intent", icon: MessageSquare },
  { kind: "action", label: "Action", icon: Flag },
  { kind: "condition", label: "Condition", icon: GitMerge },
  { kind: "end", label: "End", icon: Square },
];

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultNodeData(kind: FlowNodeKind): Record<string, unknown> {
  switch (kind) {
    case "start":
      return { label: "Start" };
    case "intent":
      return { label: "User intent", examples: [] };
    case "action":
      return { label: "Assistant action" };
    case "condition":
      return { label: "Branch", expression: "" };
    case "end":
      return { label: "End", outcome: "resolved" };
  }
}

function toRfNodes(nodes: FlowNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data },
  }));
}

function toRfEdges(edges: FlowEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label ?? undefined,
    data: e.data,
  }));
}

function toFlowNodes(nodes: Node[]): FlowNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: (n.type as FlowNodeKind) ?? "action",
    position: n.position,
    data: (n.data ?? {}) as Record<string, unknown>,
  }));
}

function toFlowEdges(edges: Edge[]): FlowEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: typeof e.label === "string" ? e.label : null,
    data: (e.data ?? {}) as Record<string, unknown>,
  }));
}

function FlowEditorInner({
  projectId,
  flow,
  tools,
  providers,
  canWrite,
}: {
  projectId: string;
  flow: FlowProp;
  tools: ToolOption[];
  providers: ProviderOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [name, setName] = useState(flow.name);
  const [description, setDescription] = useState(flow.description ?? "");
  const [isPublished, setIsPublished] = useState(flow.isPublished);
  const [nodes, setNodes] = useState<Node[]>(toRfNodes(flow.nodes));
  const [edges, setEdges] = useState<Edge[]>(toRfEdges(flow.edges));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);
  const { screenToFlowPosition } = useReactFlow();

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some((c) => c.type !== "select" && c.type !== "dimensions")) setDirty(true);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some((c) => c.type !== "select")) setDirty(true);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setEdges((es) =>
      addEdge(
        {
          id: makeId("e"),
          source: connection.source!,
          target: connection.target!,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
        },
        es,
      ),
    );
    setDirty(true);
  }, []);

  const onReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    setEdges((es) => reconnectEdge(oldEdge, newConnection, es));
    setDirty(true);
  }, []);

  const onSelectionChange = useCallback(
    ({ nodes: selN, edges: selE }: { nodes: Node[]; edges: Edge[] }) => {
      setSelectedNodeId(selN[0]?.id ?? null);
      setSelectedEdgeId(selE[0]?.id ?? null);
    },
    [],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData("application/synthgen-node-kind") as FlowNodeKind;
      if (!kind || !rfInstance) return;
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const newNode: Node = {
        id: makeId(kind),
        type: kind,
        position: pos,
        data: defaultNodeData(kind),
      };
      setNodes((ns) => [...ns, newNode]);
      setDirty(true);
    },
    [rfInstance, screenToFlowPosition],
  );

  const updateNode = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === nodeId ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n,
      ),
    );
    setDirty(true);
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNodeId(null);
    setDirty(true);
  }, []);

  const updateEdge = useCallback((edgeId: string, label: string) => {
    setEdges((es) =>
      es.map((e) => (e.id === edgeId ? { ...e, label: label || undefined } : e)),
    );
    setDirty(true);
  }, []);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((es) => es.filter((e) => e.id !== edgeId));
    setSelectedEdgeId(null);
    setDirty(true);
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );

  function applyGenerated(newNodes: FlowNode[], newEdges: FlowEdge[]) {
    setNodes(toRfNodes(newNodes));
    setEdges(toRfEdges(newEdges));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setDirty(true);
    // Re-fit the viewport after the next render so the user sees the whole graph.
    setTimeout(() => rfInstance?.fitView({ padding: 0.2 }), 50);
  }

  function persist(nextPublished?: boolean) {
    start(async () => {
      const res = await saveFlow({
        projectId,
        flowId: flow.id,
        name,
        description: description || null,
        nodes: toFlowNodes(nodes),
        edges: toFlowEdges(edges),
        ...(nextPublished != null ? { isPublished: nextPublished } : {}),
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      if (nextPublished != null) setIsPublished(nextPublished);
      setDirty(false);
      toast.success(nextPublished == null ? "Flow saved" : nextPublished ? "Published" : "Unpublished");
      router.refresh();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back">
            <Link href={`/projects/${projectId}/flows`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            disabled={!canWrite}
            className="h-8 max-w-xs"
            placeholder="Flow name"
          />
          <Input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            disabled={!canWrite}
            className="h-8 max-w-md"
            placeholder="Description (optional)"
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isPublished ? "default" : "outline"} className="text-[10px]">
            {isPublished ? "published" : "draft"} · v{flow.version}
          </Badge>
          {dirty && (
            <Badge variant="secondary" className="text-[10px]">
              unsaved
            </Badge>
          )}
          <YamlDialog
            nodes={toFlowNodes(nodes)}
            edges={toFlowEdges(edges)}
            tools={tools}
            canWrite={canWrite}
            onApply={applyGenerated}
          />
          {canWrite && (
            <>
              <GenerateFlowDialog
                projectId={projectId}
                providers={providers}
                tools={tools}
                onApply={applyGenerated}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => persist(!isPublished)}
                disabled={pending || dirty}
                title={dirty ? "Save first to publish" : undefined}
              >
                <Upload className="mr-2 h-3.5 w-3.5" />
                {isPublished ? "Unpublish" : "Publish"}
              </Button>
              <Button size="sm" onClick={() => persist()} disabled={pending}>
                <Save className="mr-2 h-3.5 w-3.5" />
                {pending ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Body: palette / canvas / inspector */}
      <div className="flex min-h-0 flex-1">
        {canWrite && (
          <aside className="w-44 shrink-0 border-r border-border bg-muted/20 p-2">
            <div className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Palette
            </div>
            <div className="space-y-1">
              {PALETTE.map(({ kind, label, icon: Icon }) => (
                <div
                  key={kind}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/synthgen-node-kind", kind);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="flex cursor-grab items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs hover:bg-muted/40 active:cursor-grabbing"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </div>
              ))}
            </div>
            <p className="mt-3 px-1 text-[10px] leading-snug text-muted-foreground">
              Drag onto the canvas. Connect nodes by dragging from a node&apos;s right handle to
              another node&apos;s left handle.
            </p>
          </aside>
        )}

        <div ref={wrapperRef} className="min-w-0 flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onSelectionChange={onSelectionChange}
            onInit={setRfInstance}
            nodesConnectable={canWrite}
            nodesDraggable={canWrite}
            elementsSelectable
            edgesReconnectable={canWrite}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls position="bottom-left" />
            <MiniMap pannable zoomable className="!bg-card" />
          </ReactFlow>
        </div>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-background">
          <NodeInspector
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            tools={tools}
            canWrite={canWrite}
            onUpdateNode={updateNode}
            onDeleteNode={deleteNode}
            onUpdateEdge={updateEdge}
            onDeleteEdge={deleteEdge}
          />
        </aside>
      </div>
    </div>
  );
}

export function FlowEditor(props: {
  projectId: string;
  flow: FlowProp;
  tools: ToolOption[];
  providers: ProviderOption[];
  canWrite: boolean;
}) {
  // ReactFlowProvider gives us the screen→flow coordinate hook for drag/drop.
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
