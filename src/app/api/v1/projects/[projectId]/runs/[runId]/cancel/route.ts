import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { cancelRun, tryCall } from "@/lib/synthgen-api";

export const runtime = "nodejs";

// POST /api/v1/projects/:projectId/runs/:runId/cancel
// Cancel a running/queued run. Mirrors `cancelRunAction` in the UI — tells
// the Python worker to stop dispatching new jobs and marks all pending jobs
// as `skipped`. Idempotent: cancelling an already-terminal run is a no-op.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, runId } = await params;
    const perm = await checkProjectPermission(user, projectId, "runs.cancel");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const run = await prisma.generationRun.findFirst({
      where: { id: runId, projectId },
      select: { id: true, status: true },
    });
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });

    await tryCall(() => cancelRun(runId), `cancel run ${runId}`);
    await prisma.generationRun.updateMany({
      where: { id: runId, status: { in: ["queued", "running", "paused"] } },
      data: { status: "cancelled", completedAt: new Date() },
    });
    const skipped = await prisma.generationJob.updateMany({
      where: { runId, status: "pending" },
      data: { status: "skipped" },
    });

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "run.cancel",
      targetKind: "GenerationRun",
      targetId: runId,
      metadata: { jobsSkipped: skipped.count, viaApi: true },
    });

    return Response.json({
      ok: true,
      run: { id: runId, status: "cancelled" },
      jobsSkipped: skipped.count,
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
