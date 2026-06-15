import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// DELETE /api/v1/projects/:projectId/taxonomy/:nodeId
// Removes a taxonomy node (and, via cascade, its children + run/conversation
// link rows). Confirms the node belongs to the project before deleting so
// cross-project ids 404. Mirrors deleteTaxonomyNode.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; nodeId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, nodeId } = await params;
    const perm = await checkProjectPermission(user, projectId, "taxonomy.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const node = await prisma.taxonomyNode.findFirst({
      where: { id: nodeId, taxonomy: { projectId } },
      select: { id: true },
    });
    if (!node) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.taxonomyNode.delete({ where: { id: nodeId } });

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "taxonomy.node.delete",
      targetKind: "TaxonomyNode",
      targetId: nodeId,
      metadata: { viaApi: true },
    });

    return Response.json({ ok: true, id: nodeId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
