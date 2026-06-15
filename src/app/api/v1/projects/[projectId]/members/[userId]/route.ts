import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// DELETE /api/v1/projects/:projectId/members/:userId — remove a member.
// Refuses to remove the last OWNER. Mirrors `removeProjectMember`.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; userId: string }> },
) {
  try {
    const actor = await requireUserFromRequest(req);
    const { projectId, userId } = await params;
    const perm = await checkProjectPermission(actor, projectId, "members.manage");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (!member) return Response.json({ error: "Not found" }, { status: 404 });

    if (member.role === "OWNER") {
      const ownerCount = await prisma.projectMember.count({
        where: { projectId, role: "OWNER" },
      });
      if (ownerCount <= 1) {
        return Response.json(
          { error: "Cannot remove the last OWNER. Transfer ownership first." },
          { status: 409 },
        );
      }
    }

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
    await logAudit({
      projectId,
      actorUserId: actor.id,
      action: "members.remove",
      targetKind: "User",
      targetId: userId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, userId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
