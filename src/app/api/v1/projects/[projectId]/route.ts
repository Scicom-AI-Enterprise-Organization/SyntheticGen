import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId — project detail + resource counts + the
// caller's role.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "project.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        defaultFormality: true,
        labelingBaseUrl: true,
        archivedAt: true,
        createdAt: true,
      },
    });
    if (!project) return Response.json({ error: "Not found" }, { status: 404 });

    const [
      personas,
      templates,
      tools,
      languageProfiles,
      flows,
      runs,
      conversations,
      benchmarks,
      datasets,
    ] = await Promise.all([
      prisma.persona.count({ where: { projectId } }),
      prisma.promptTemplate.count({ where: { projectId } }),
      prisma.toolDef.count({ where: { catalog: { projectId } } }),
      prisma.languageProfile.count({ where: { projectId } }),
      prisma.flow.count({ where: { projectId } }),
      prisma.generationRun.count({ where: { projectId } }),
      prisma.conversation.count({ where: { projectId } }),
      prisma.benchmark.count({ where: { projectId } }),
      prisma.dataset.count({ where: { projectId } }),
    ]);

    return Response.json({
      project: {
        ...project,
        archivedAt: project.archivedAt?.toISOString() ?? null,
        createdAt: project.createdAt.toISOString(),
        role: perm.role,
        counts: {
          personas,
          templates,
          tools,
          languageProfiles,
          flows,
          runs,
          conversations,
          benchmarks,
          datasets,
        },
      },
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// PATCH /api/v1/projects/:projectId — update name/description/defaultFormality.
// Mirrors `updateProject` (labeling-platform secret fields are intentionally
// not settable via the API). Requires project.update.
const patchSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(500).optional().nullable(),
    defaultFormality: z
      .enum(["formal", "semi-formal", "colloquial", "mixed"])
      .optional(),
    labelingBaseUrl: z.string().url().optional().nullable(),
  })
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "project.update");
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

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: parsed.data,
      select: { id: true, name: true, slug: true, defaultFormality: true },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "project.update",
      targetKind: "Project",
      targetId: projectId,
      metadata: { ...parsed.data, viaApi: true },
    });
    return Response.json({ ok: true, project: updated });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE /api/v1/projects/:projectId — archive (soft delete). Mirrors
// `archiveProject`. Requires project.delete.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "project.delete");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date() },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "project.archive",
      targetKind: "Project",
      targetId: projectId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, id: projectId, archived: true });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
