import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// DELETE /api/v1/projects/:projectId/ensemble-groups/:groupId
// Mirrors `deleteEnsembleGroup`. Benchmark.defaultEnsembleGroupId and
// BenchmarkRun.ensembleGroupId null out on delete (SetNull).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; groupId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, groupId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const group = await prisma.ensembleJudgeGroup.findFirst({
      where: { id: groupId, projectId },
      select: { id: true, name: true },
    });
    if (!group) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.ensembleJudgeGroup.delete({ where: { id: groupId } });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "ensemble_group.delete",
      targetKind: "EnsembleJudgeGroup",
      targetId: groupId,
      metadata: { name: group.name, viaApi: true },
    });
    return Response.json({ ok: true, id: groupId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
