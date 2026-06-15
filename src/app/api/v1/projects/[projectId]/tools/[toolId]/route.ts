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

// PATCH /api/v1/projects/:projectId/tools/:toolId — partial update.
// Changing any field bumps the tool version. Mirrors `updateToolDef`.
const patchSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Use snake_case identifier")
      .optional(),
    description: z.string().min(1).max(2000).optional(),
    parameters: z.unknown().optional(),
    localePresets: z.array(z.string()).optional(),
    examples: z.array(z.record(z.string(), z.unknown())).optional().nullable(),
  })
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; toolId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, toolId } = await params;
    const perm = await checkProjectPermission(user, projectId, "tools.write");
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

    const existing = await prisma.toolDef.findFirst({
      where: { id: toolId, catalog: { projectId } },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const data: Prisma.ToolDefUpdateInput = { version: { increment: 1 } };
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined)
      data.description = parsed.data.description;
    if (parsed.data.localePresets !== undefined)
      data.localePresets = parsed.data.localePresets;
    if (parsed.data.parameters !== undefined) {
      if (
        !parsed.data.parameters ||
        typeof parsed.data.parameters !== "object" ||
        Array.isArray(parsed.data.parameters)
      ) {
        return Response.json(
          { error: "parameters must be a JSON Schema object" },
          { status: 400 },
        );
      }
      data.parameters = parsed.data.parameters as Prisma.InputJsonValue;
    }
    if (parsed.data.examples !== undefined) {
      data.examples =
        parsed.data.examples && parsed.data.examples.length > 0
          ? (parsed.data.examples as Prisma.InputJsonValue)
          : Prisma.JsonNull;
    }

    const updated = await prisma.toolDef.update({
      where: { id: toolId },
      data,
      select: { id: true, name: true, version: true },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "tool.update",
      targetKind: "ToolDef",
      targetId: toolId,
      metadata: { name: updated.name, version: updated.version, viaApi: true },
    });
    return Response.json({ ok: true, tool: updated });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE — mirrors deleteToolDef.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; toolId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, toolId } = await params;
    const perm = await checkProjectPermission(user, projectId, "tools.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const existing = await prisma.toolDef.findFirst({
      where: { id: toolId, catalog: { projectId } },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    try {
      await prisma.toolDef.delete({ where: { id: toolId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2003"
      ) {
        return Response.json(
          { error: "Tool is referenced elsewhere and can't be deleted." },
          { status: 409 },
        );
      }
      throw e;
    }
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "tool.delete",
      targetKind: "ToolDef",
      targetId: toolId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, id: toolId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
