// Normalize an arbitrary `{nodes, edges}` blob (from the LLM, from pasted YAML,
// from a Figma import — etc.) into our canonical FlowNode[] / FlowEdge[].
// Drops invalid bits, never throws on per-item issues; collects a list of
// human-readable warnings the caller can surface in the UI.

import type { FlowEdge, FlowNode, FlowNodeKind } from "./types";

const VALID_KINDS: ReadonlyArray<FlowNodeKind> = [
  "start",
  "intent",
  "action",
  "condition",
  "end",
];

export interface CoercedGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  warnings: string[];
}

export interface CoerceOptions {
  // When provided, action.toolIds entries not in the set are dropped (with a warning).
  validToolIds?: Set<string>;
  // When false (default), we synthesize { x: 0, y: 0 } for nodes missing a position;
  // the caller is expected to run autoLayout(). When true, we keep whatever position
  // the input had — useful when round-tripping YAML that already has positions.
  preservePositions?: boolean;
}

export function coerceFlowGraph(raw: unknown, opts: CoerceOptions = {}): CoercedGraph {
  const warnings: string[] = [];

  if (!raw || typeof raw !== "object") {
    throw new Error("Expected an object with `nodes` and `edges`.");
  }
  const obj = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: FlowNode[] = [];
  const seenIds = new Set<string>();
  for (const n of rawNodes) {
    if (!n || typeof n !== "object") continue;
    const node = n as Record<string, unknown>;
    const id = typeof node.id === "string" ? node.id : "";
    const type = node.type as FlowNodeKind;
    if (!id || !VALID_KINDS.includes(type)) {
      warnings.push(`Skipped invalid node: ${JSON.stringify(node).slice(0, 80)}`);
      continue;
    }
    if (seenIds.has(id)) {
      warnings.push(`Duplicate node id "${id}" — skipping the second one`);
      continue;
    }
    seenIds.add(id);

    const data = (node.data && typeof node.data === "object" ? node.data : {}) as Record<
      string,
      unknown
    >;

    if (type === "action" && Array.isArray(data.toolIds) && opts.validToolIds) {
      const filtered = (data.toolIds as unknown[]).filter(
        (x): x is string => typeof x === "string" && opts.validToolIds!.has(x),
      );
      const dropped = (data.toolIds as unknown[]).length - filtered.length;
      if (dropped > 0) {
        warnings.push(
          `Action "${id}": dropped ${dropped} unknown tool id${dropped === 1 ? "" : "s"}`,
        );
      }
      data.toolIds = filtered;
    }

    let position = { x: 0, y: 0 };
    if (
      opts.preservePositions &&
      node.position &&
      typeof node.position === "object" &&
      typeof (node.position as Record<string, unknown>).x === "number" &&
      typeof (node.position as Record<string, unknown>).y === "number"
    ) {
      position = node.position as { x: number; y: number };
    }

    nodes.push({ id, type, position, data });
  }

  const startCount = nodes.filter((n) => n.type === "start").length;
  if (startCount === 0) {
    throw new Error("Graph is missing a start node.");
  }
  if (startCount > 1) {
    warnings.push("Multiple start nodes — keeping the first, demoting the rest to intents");
    let kept = false;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].type === "start") {
        if (kept) nodes[i] = { ...nodes[i], type: "intent" };
        else kept = true;
      }
    }
  }

  const validIds = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = [];
  const seenEdgeIds = new Set<string>();
  for (let i = 0; i < rawEdges.length; i++) {
    const e = rawEdges[i];
    if (!e || typeof e !== "object") continue;
    const edge = e as Record<string, unknown>;
    const source = edge.source as string;
    const target = edge.target as string;
    if (!validIds.has(source) || !validIds.has(target)) {
      warnings.push(`Edge ${source}→${target} references a missing node — dropped`);
      continue;
    }
    let id = typeof edge.id === "string" && edge.id.length > 0 ? edge.id : `e${i + 1}`;
    while (seenEdgeIds.has(id)) id = `${id}_${Math.random().toString(36).slice(2, 5)}`;
    seenEdgeIds.add(id);
    edges.push({
      id,
      source,
      target,
      label: typeof edge.label === "string" ? edge.label : null,
    });
  }

  return { nodes, edges, warnings };
}

// Strip layout-only fields and other noise so YAML output is stable / git-friendly.
export function toExportShape(nodes: FlowNode[], edges: FlowEdge[]) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      // Keep positions in the export so users who hand-positioned nodes can
      // round-trip without losing layout. Use integer-rounded values to keep
      // diffs small.
      position: {
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      },
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.label ? { label: e.label } : {}),
    })),
  };
}
