// Tiny topological-layered layout for AI-generated flows.
// BFS from start; assigns x by depth, y by sibling index. Doesn't try to be
// pretty for arbitrary graphs — just deterministic and readable.

import type { FlowEdge, FlowNode } from "./types";

const COL_WIDTH = 240;
const ROW_HEIGHT = 120;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;

export function autoLayout(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  if (nodes.length === 0) return nodes;

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

  // Bucket by depth, preserving insertion order for stable y assignment.
  const buckets = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d)!.push(n.id);
  }

  const positionById = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of buckets) {
    ids.forEach((id, i) => {
      positionById.set(id, {
        x: ORIGIN_X + d * COL_WIDTH,
        y: ORIGIN_Y + i * ROW_HEIGHT,
      });
    });
  }

  return nodes.map((n) => ({
    ...n,
    position: positionById.get(n.id) ?? n.position ?? { x: ORIGIN_X, y: ORIGIN_Y },
  }));
}
