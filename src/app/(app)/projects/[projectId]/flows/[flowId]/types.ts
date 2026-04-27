// Shared shapes between the editor, server actions, and (eventually) the worker.
// These mirror what we persist into Flow.nodes / Flow.edges JSONB.

export type FlowNodeKind = "start" | "intent" | "action" | "condition" | "end";

export interface FlowNodeBase {
  id: string;
  type: FlowNodeKind;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

// Per-kind data shapes. Editor components read/write these via the generic Record above
// so the JSON column stays loose; this is the canonical contract for downstream code.
export interface StartNodeData extends Record<string, unknown> {
  label: string;
}

export interface IntentNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  // Example utterances the worker can rewrite into a user turn.
  examples?: string[];
}

export interface ActionNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  // Ordered list of ToolDef.id values to call at this turn. Order matters when
  // toolMode = "sequential" (each call sees earlier results); ignored when
  // toolMode = "parallel" (model emits parallel tool_calls in one shot).
  toolIds?: string[];
  // sequential | parallel — defaults to "sequential" if omitted.
  toolMode?: "sequential" | "parallel";
}

export interface ConditionNodeData extends Record<string, unknown> {
  label: string;
  // Free-text condition (slice 2 will parse / structure this).
  expression?: string;
}

export interface EndNodeData extends Record<string, unknown> {
  label: string;
  // resolved | escalated | abandoned
  outcome?: string;
}

export type FlowNode = FlowNodeBase & {
  data:
    | StartNodeData
    | IntentNodeData
    | ActionNodeData
    | ConditionNodeData
    | EndNodeData
    | Record<string, unknown>;
};

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  // Shown on the edge — used for condition labels like "tool.success".
  label?: string | null;
  data?: Record<string, unknown>;
}
