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

const axisSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z][a-z0-9_]*$/, "key must be lowercase snake_case"),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(1000),
  scale: z.number().int().min(2).max(10),
  weight: z.number().min(0).max(10),
  examples: z
    .array(
      z.object({
        score: z.number().int(),
        output: z.string().max(2000),
        reason: z.string().max(500).optional().nullable(),
      }),
    )
    .max(8)
    .optional()
    .nullable(),
});

// PATCH /api/v1/projects/:projectId/rubrics/:rubricId — partial update.
// Preset rubrics are read-only. Mirrors `updateRubric`.
const patchSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(1000).optional().nullable(),
    axes: z.array(axisSchema).min(1).max(10).optional(),
  })
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; rubricId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, rubricId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.write");
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
    if (parsed.data.axes) {
      const keys = new Set(parsed.data.axes.map((a) => a.key));
      if (keys.size !== parsed.data.axes.length) {
        return Response.json(
          { error: "Axis keys must be unique within a rubric" },
          { status: 400 },
        );
      }
    }

    const existing = await prisma.rubric.findFirst({
      where: { id: rubricId, projectId },
      select: { id: true, isPreset: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
    if (existing.isPreset) {
      return Response.json(
        { error: "Preset rubrics are read-only; clone it first" },
        { status: 409 },
      );
    }

    const data: Prisma.RubricUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined)
      data.description = parsed.data.description;
    if (parsed.data.axes !== undefined)
      data.axes = parsed.data.axes as unknown as Prisma.InputJsonValue;

    try {
      const updated = await prisma.rubric.update({
        where: { id: rubricId },
        data,
        select: { id: true, name: true },
      });
      await logAudit({
        projectId,
        actorUserId: user.id,
        action: "rubric.update",
        targetKind: "Rubric",
        targetId: rubricId,
        metadata: { viaApi: true },
      });
      return Response.json({ ok: true, rubric: updated });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return Response.json(
          { error: "A rubric with this name already exists" },
          { status: 409 },
        );
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE — preset rubrics can't be deleted. Mirrors deleteRubric.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; rubricId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, rubricId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const existing = await prisma.rubric.findFirst({
      where: { id: rubricId, projectId },
      select: { id: true, isPreset: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
    if (existing.isPreset) {
      return Response.json(
        { error: "Preset rubrics cannot be deleted" },
        { status: 409 },
      );
    }

    try {
      await prisma.rubric.delete({ where: { id: rubricId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2003"
      ) {
        return Response.json(
          { error: "Rubric is referenced by a benchmark/run and can't be deleted." },
          { status: 409 },
        );
      }
      throw e;
    }
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "rubric.delete",
      targetKind: "Rubric",
      targetId: rubricId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, id: rubricId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
