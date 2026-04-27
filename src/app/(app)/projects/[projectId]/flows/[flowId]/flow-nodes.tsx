"use client";

import { Handle, Position } from "@xyflow/react";
import { Flag, GitMerge, MessageSquare, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ActionNodeData,
  ConditionNodeData,
  EndNodeData,
  IntentNodeData,
  StartNodeData,
} from "./types";

const BASE =
  "rounded-md border bg-card px-3 py-2 text-xs shadow-sm transition-shadow min-w-[160px] max-w-[260px]";

interface CustomNodeProps<TData> {
  data: TData;
  selected?: boolean;
}

export function StartNode({ data, selected }: CustomNodeProps<StartNodeData>) {
  return (
    <div
      className={cn(
        BASE,
        "border-emerald-500/50 bg-emerald-500/10",
        selected && "ring-2 ring-emerald-500/60",
      )}
    >
      <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
        <Play className="h-3 w-3" />
        Start
      </div>
      {data.label && data.label !== "Start" && (
        <div className="mt-1 text-muted-foreground">{data.label}</div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-emerald-500" />
    </div>
  );
}

export function IntentNode({ data, selected }: CustomNodeProps<IntentNodeData>) {
  return (
    <div
      className={cn(
        BASE,
        "border-blue-500/50 bg-blue-500/5",
        selected && "ring-2 ring-blue-500/60",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-blue-500" />
      <div className="flex items-center gap-1.5 font-medium text-blue-700 dark:text-blue-300">
        <MessageSquare className="h-3 w-3" />
        Intent
      </div>
      <div className="mt-1 line-clamp-2 font-medium text-foreground">
        {data.label || <span className="text-muted-foreground">unnamed</span>}
      </div>
      {data.description && (
        <div className="mt-0.5 line-clamp-2 text-muted-foreground">{data.description}</div>
      )}
      {Array.isArray(data.examples) && data.examples.length > 0 && (
        <div className="mt-1 italic text-muted-foreground/80">
          “{String(data.examples[0]).slice(0, 60)}”
          {data.examples.length > 1 && ` +${data.examples.length - 1}`}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-blue-500" />
    </div>
  );
}

export function ActionNode({ data, selected }: CustomNodeProps<ActionNodeData>) {
  const toolCount = Array.isArray(data.toolIds) ? data.toolIds.length : 0;
  const mode = data.toolMode === "parallel" ? "parallel" : "sequential";
  return (
    <div
      className={cn(
        BASE,
        "border-violet-500/50 bg-violet-500/5",
        selected && "ring-2 ring-violet-500/60",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-violet-500" />
      <div className="flex items-center gap-1.5 font-medium text-violet-700 dark:text-violet-300">
        <Flag className="h-3 w-3" />
        Action
        {toolCount > 0 && (
          <span className="rounded-sm bg-violet-500/20 px-1 text-[9px] uppercase">
            {toolCount} tool{toolCount === 1 ? "" : "s"} {mode === "parallel" ? "∥" : "→"}
          </span>
        )}
      </div>
      <div className="mt-1 line-clamp-2 font-medium text-foreground">
        {data.label || <span className="text-muted-foreground">unnamed</span>}
      </div>
      {data.description && (
        <div className="mt-0.5 line-clamp-3 text-muted-foreground">{data.description}</div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-violet-500" />
    </div>
  );
}

export function ConditionNode({ data, selected }: CustomNodeProps<ConditionNodeData>) {
  return (
    <div
      className={cn(
        BASE,
        "border-amber-500/60 bg-amber-500/10",
        selected && "ring-2 ring-amber-500/60",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-500" />
      <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
        <GitMerge className="h-3 w-3" />
        Condition
      </div>
      <div className="mt-1 line-clamp-2 font-medium text-foreground">
        {data.label || <span className="text-muted-foreground">unnamed</span>}
      </div>
      {data.expression && (
        <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {data.expression}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-amber-500" />
    </div>
  );
}

export function EndNode({ data, selected }: CustomNodeProps<EndNodeData>) {
  const outcomeColor =
    data.outcome === "escalated"
      ? "border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      : data.outcome === "abandoned"
        ? "border-zinc-500/50 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300"
        : "border-slate-500/50 bg-slate-500/10 text-slate-700 dark:text-slate-300";
  return (
    <div className={cn(BASE, outcomeColor, selected && "ring-2 ring-slate-500/60")}>
      <Handle type="target" position={Position.Left} className="!bg-slate-500" />
      <div className="flex items-center gap-1.5 font-medium">
        <Square className="h-3 w-3" />
        End
      </div>
      <div className="mt-1 line-clamp-2 font-medium text-foreground">
        {data.label || "End"}
      </div>
      {data.outcome && (
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {data.outcome}
        </div>
      )}
    </div>
  );
}

export const NODE_TYPES = {
  start: StartNode,
  intent: IntentNode,
  action: ActionNode,
  condition: ConditionNode,
  end: EndNode,
} as const;
