import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const FLOW_NODE_KINDS = ["start", "intent", "action", "condition", "end"] as const;

// GET /api/v1/projects/:projectId/flows/:flowId — full flow incl. nodes/edges.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; flowId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, flowId } = await params;
    const perm = await checkProjectPermission(user, projectId, "flows.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const flow = await prisma.flow.findFirst({
      where: { id: flowId, projectId },
      select: {
        id: true,
        name: true,
        description: true,
        version: true,
        isPublished: true,
        nodes: true,
        edges: true,
        createdAt: true,
      },
    });
    if (!flow) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({
      flow: { ...flow, createdAt: flow.createdAt.toISOString() },
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// PATCH /api/v1/projects/:projectId/flows/:flowId — author/publish a flow.
// Send nodes+edges together to replace the graph (validated: edges reference
// known nodes, exactly one start node), and/or isPublished to (un)publish, and
// /or name/description. Mirrors `saveFlow`.
const flowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(FLOW_NODE_KINDS),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()).default({}),
});
const flowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional().nullable(),
  data: z.record(z.string(), z.unknown()).optional(),
});
const patchSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(500).optional().nullable(),
    nodes: z.array(flowNodeSchema).min(1).optional(),
    edges: z.array(flowEdgeSchema).optional(),
    isPublished: z.boolean().optional(),
  })
  .strict()
  .refine((d) => (d.nodes === undefined) === (d.edges === undefined), {
    message: "nodes and edges must be provided together",
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; flowId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, flowId } = await params;
    const perm = await checkProjectPermission(user, projectId, "flows.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    if (Object.keys(parsed.data).length === 0) {
      return Response.json({ error: "No fields to update" }, { status: 400 });
    }

    const flow = await prisma.flow.findFirst({
      where: { id: flowId, projectId },
      select: { id: true },
    });
    if (!flow) return Response.json({ error: "Not found" }, { status: 404 });

    if (parsed.data.nodes && parsed.data.edges) {
      const nodeIds = new Set(parsed.data.nodes.map((n) => n.id));
      for (const e of parsed.data.edges) {
        if (!nodeIds.has(e.source))
          return Response.json(
            { error: `edge source "${e.source}" is missing` },
            { status: 400 },
          );
        if (!nodeIds.has(e.target))
          return Response.json(
            { error: `edge target "${e.target}" is missing` },
            { status: 400 },
          );
      }
      if (parsed.data.nodes.filter((n) => n.type === "start").length !== 1) {
        return Response.json(
          { error: "Flow needs exactly one Start node" },
          { status: 400 },
        );
      }
    }

    const data: Prisma.FlowUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined)
      data.description = parsed.data.description;
    if (parsed.data.isPublished !== undefined)
      data.isPublished = parsed.data.isPublished;
    if (parsed.data.nodes && parsed.data.edges) {
      data.nodes = parsed.data.nodes as unknown as Prisma.InputJsonValue;
      data.edges = parsed.data.edges as unknown as Prisma.InputJsonValue;
    }

    const updated = await prisma.flow.update({
      where: { id: flowId },
      data,
      select: { id: true, name: true, isPublished: true, version: true },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "flow.save",
      targetKind: "Flow",
      targetId: flowId,
      metadata: { isPublished: parsed.data.isPublished ?? null, viaApi: true },
    });
    return Response.json({ ok: true, flow: updated });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE — mirrors deleteFlow.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; flowId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, flowId } = await params;
    const perm = await checkProjectPermission(user, projectId, "flows.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const flow = await prisma.flow.findFirst({
      where: { id: flowId, projectId },
      select: { id: true },
    });
    if (!flow) return Response.json({ error: "Not found" }, { status: 404 });

    try {
      await prisma.flow.delete({ where: { id: flowId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2003"
      ) {
        return Response.json(
          { error: "Flow is referenced by a run and can't be deleted." },
          { status: 409 },
        );
      }
      throw e;
    }
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "flow.delete",
      targetKind: "Flow",
      targetId: flowId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, id: flowId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
