// Tiny topological-layered layout for AI-generated flows. Supports three modes:
//   horizontal — BFS from start; columns by depth (x), rows by sibling index (y).
//   vertical   — same topology but axes swapped: rows by depth (y), columns by sibling index (x).
//   box        — square-ish grid by node order, used to "fit to screen" without
//                requiring graph depth (handy for orphan-heavy or cyclic graphs).
// All modes are deterministic; the editor user can drag nodes wherever they
// want afterwards.

import type { FlowEdge, FlowNode } from "./types";

export type LayoutMode = "horizontal" | "vertical" | "box";

// Tuned for the variable node heights produced by intent (examples list),
// action (tool chips), and condition (expression preview) nodes.
const COL_WIDTH = 380;
const ROW_HEIGHT = 220;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;

export function autoLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
  mode: LayoutMode = "horizontal",
): FlowNode[] {
  if (nodes.length === 0) return nodes;
  if (mode === "box") return boxLayout(nodes);
  return layeredLayout(nodes, edges, mode);
}

function layeredLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
  mode: "horizontal" | "vertical",
): FlowNode[] {
  const start = nodes.find((n) => n.type === "start") ?? nodes[0];

  // Adjacency: source -> targets (preserves edge order).
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  // BFS from start to assign depths.
  const depth = new Map<string, number>([[start.id, 0]]);
  const queue: string[] = [start.id];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const t of adj.get(cur) ?? []) {
      if (!depth.has(t)) {
        depth.set(t, d + 1);
        queue.push(t);
      } else {
        // Allow refinement: keep the deeper position so back-references don't
        // pull a node leftward, but never shrink. (Cycles → first reach wins.)
        const next = Math.max(depth.get(t)!, d + 1);
        if (next !== depth.get(t)) {
          depth.set(t, next);
          queue.push(t);
        }
      }
    }
  }

  // Orphan nodes (unreachable from start): tack them onto the rightmost column.
  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  for (const n of nodes) {
    if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);
  }

  // Bucket by depth, preserving insertion order for stable sibling assignment.
  const buckets = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d)!.push(n.id);
  }

  const positionById = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of buckets) {
    ids.forEach((id, i) => {
      if (mode === "horizontal") {
        positionById.set(id, {
          x: ORIGIN_X + d * COL_WIDTH,
          y: ORIGIN_Y + i * ROW_HEIGHT,
        });
      } else {
        // vertical: depth flows down, siblings flow right.
        positionById.set(id, {
          x: ORIGIN_X + i * COL_WIDTH,
          y: ORIGIN_Y + d * ROW_HEIGHT,
        });
      }
    });
  }

  return nodes.map((n) => ({
    ...n,
    position: positionById.get(n.id) ?? n.position ?? { x: ORIGIN_X, y: ORIGIN_Y },
  }));
}

function boxLayout(nodes: FlowNode[]): FlowNode[] {
  // Square-ish grid in node insertion order. start node is forced first so it
  // lands top-left even if it was inserted later.
  const ordered: FlowNode[] = [];
  const start = nodes.find((n) => n.type === "start");
  if (start) ordered.push(start);
  for (const n of nodes) if (n !== start) ordered.push(n);

  const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  return nodes.map((n) => {
    const idx = ordered.indexOf(n);
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    return {
      ...n,
      position: {
        x: ORIGIN_X + col * COL_WIDTH,
        y: ORIGIN_Y + row * ROW_HEIGHT,
      },
    };
  });
}
