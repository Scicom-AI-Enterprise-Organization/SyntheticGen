import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// PATCH /api/v1/projects/:projectId/knowledge/:entryId — partial update.
// Mirrors `updateKnowledgeEntry`.
const patchSchema = z
  .object({
    title: z.string().min(1).max(240).optional(),
    content: z.string().min(1).max(50_000).optional(),
    tags: z.array(z.string()).optional(),
    taxonomyNodeIds: z.array(z.string()).optional(),
    sourceUrl: z.string().url().optional().nullable(),
  })
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; entryId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, entryId } = await params;
    const perm = await checkProjectPermission(user, projectId, "knowledge.write");
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

    const existing = await prisma.knowledgeBaseEntry.findFirst({
      where: { id: entryId, projectId },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.knowledgeBaseEntry.update({
      where: { id: entryId },
      data: parsed.data,
      select: { id: true, title: true },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "knowledge.update",
      targetKind: "KnowledgeBaseEntry",
      targetId: entryId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, entry: updated });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE — mirrors deleteKnowledgeEntry.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; entryId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, entryId } = await params;
    const perm = await checkProjectPermission(user, projectId, "knowledge.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const existing = await prisma.knowledgeBaseEntry.findFirst({
      where: { id: entryId, projectId },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.knowledgeBaseEntry.delete({ where: { id: entryId } });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "knowledge.delete",
      targetKind: "KnowledgeBaseEntry",
      targetId: entryId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, id: entryId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
