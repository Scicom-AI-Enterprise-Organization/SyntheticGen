"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

const FLOW_NODE_KINDS = ["start", "intent", "action", "condition", "end"] as const;

// Default starter graph: a single Start node + one End node, ready for editing.
function emptyGraph() {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 80, y: 80 },
        data: { label: "Start" },
      },
      {
        id: "end",
        type: "end",
        position: { x: 480, y: 80 },
        data: { label: "End", outcome: "resolved" },
      },
    ],
    edges: [],
  };
}

const createSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
});

export async function createFlow(input: z.infer<typeof createSchema>) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "flows.write");

  const { nodes, edges } = emptyGraph();
  const created = await prisma.flow.create({
    data: {
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      nodes: nodes as unknown as Prisma.InputJsonValue,
      edges: edges as unknown as Prisma.InputJsonValue,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "flow.create",
    targetKind: "Flow",
    targetId: created.id,
    metadata: { name: created.name },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/flows`);
  return { ok: true, id: created.id };
}

const flowNodeSchema = z
  .object({
    id: z.string(),
    type: z.enum(FLOW_NODE_KINDS),
    position: z.object({ x: z.number(), y: z.number() }),
    data: z.record(z.unknown()).default({}),
  })
  .superRefine((node, ctx) => {
    if (node.type !== "action") return;
    const d = node.data as Record<string, unknown>;
    if (d.toolIds != null) {
      const ok =
        Array.isArray(d.toolIds) &&
        (d.toolIds as unknown[]).every((x) => typeof x === "string");
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Action node "${node.id}".toolIds must be a string[]`,
        });
      }
    }
    if (d.toolMode != null && d.toolMode !== "sequential" && d.toolMode !== "parallel") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Action node "${node.id}".toolMode must be "sequential" or "parallel"`,
      });
    }
  });

const flowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional().nullable(),
  data: z.record(z.unknown()).optional(),
});

const saveSchema = z.object({
  projectId: z.string(),
  flowId: z.string(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  nodes: z.array(flowNodeSchema).min(1),
  edges: z.array(flowEdgeSchema),
  isPublished: z.boolean().optional(),
});

export async function saveFlow(input: z.infer<typeof saveSchema>) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "flows.write");

  // Cheap structural sanity: every edge points at known nodes; one start node only;
  // start must not have inbound edges; end must not have outbound edges.
  const nodeIds = new Set(parsed.data.nodes.map((n) => n.id));
  for (const e of parsed.data.edges) {
    if (!nodeIds.has(e.source)) return { error: `edge source "${e.source}" is missing` };
    if (!nodeIds.has(e.target)) return { error: `edge target "${e.target}" is missing` };
  }
  const startCount = parsed.data.nodes.filter((n) => n.type === "start").length;
  if (startCount !== 1) return { error: "Flow needs exactly one Start node" };

  const flow = await prisma.flow.findUnique({ where: { id: parsed.data.flowId } });
  if (!flow || flow.projectId !== parsed.data.projectId) return { error: "Flow not found" };

  await prisma.flow.update({
    where: { id: parsed.data.flowId },
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      nodes: parsed.data.nodes as unknown as Prisma.InputJsonValue,
      edges: parsed.data.edges as unknown as Prisma.InputJsonValue,
      ...(parsed.data.isPublished != null ? { isPublished: parsed.data.isPublished } : {}),
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "flow.save",
    targetKind: "Flow",
    targetId: parsed.data.flowId,
    metadata: {
      nodes: parsed.data.nodes.length,
      edges: parsed.data.edges.length,
      isPublished: parsed.data.isPublished ?? null,
    },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/flows`);
  revalidatePath(`/projects/${parsed.data.projectId}/flows/${parsed.data.flowId}`);
  return { ok: true };
}

export async function deleteFlow(projectId: string, flowId: string) {
  const { user } = await requireProjectPermission(projectId, "flows.write");
  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow || flow.projectId !== projectId) return { error: "Flow not found" };
  await prisma.flow.delete({ where: { id: flowId } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "flow.delete",
    targetKind: "Flow",
    targetId: flowId,
  });
  revalidatePath(`/projects/${projectId}/flows`);
  return { ok: true };
}
