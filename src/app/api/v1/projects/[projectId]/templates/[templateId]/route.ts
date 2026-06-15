import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// PATCH /api/v1/projects/:projectId/templates/:templateId — partial update.
// Editing the body bumps the template version (historical runs keep their
// snapshot). Mirrors `updateTemplate`.
const patchSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    kind: z
      .enum(["system", "user-seed", "judge", "conversation-driver"])
      .optional(),
    description: z.string().max(2000).optional().nullable(),
    body: z.string().min(1).max(50000).optional(),
  })
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; templateId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, templateId } = await params;
    const perm = await checkProjectPermission(user, projectId, "templates.write");
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

    const existing = await prisma.promptTemplate.findFirst({
      where: { id: templateId, projectId },
      select: { id: true, body: true, version: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const bodyChanged =
      parsed.data.body !== undefined && parsed.data.body !== existing.body;
    const updated = await prisma.promptTemplate.update({
      where: { id: templateId },
      data: {
        ...parsed.data,
        version: bodyChanged ? existing.version + 1 : existing.version,
      },
      select: { id: true, name: true, kind: true, version: true },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "template.update",
      targetKind: "PromptTemplate",
      targetId: templateId,
      metadata: { bodyChanged, newVersion: updated.version, viaApi: true },
    });
    return Response.json({ ok: true, template: updated });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE — refuses if any run references the template. Mirrors deleteTemplate.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; templateId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, templateId } = await params;
    const perm = await checkProjectPermission(user, projectId, "templates.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const existing = await prisma.promptTemplate.findFirst({
      where: { id: templateId, projectId },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const refCount = await prisma.generationRun.count({
      where: { templateId },
    });
    if (refCount > 0) {
      return Response.json(
        { error: `Cannot delete: ${refCount} run(s) reference this template` },
        { status: 409 },
      );
    }
    await prisma.promptTemplate.delete({ where: { id: templateId } });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "template.delete",
      targetKind: "PromptTemplate",
      targetId: templateId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, id: templateId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
