import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/v1/projects/:projectId/benchmarks/:benchmarkId/runs/:runId/cancel
// Flip a queued/running benchmark run to cancelled. Idempotent. Mirrors
// `cancelBenchmarkRun`.
export async function POST(
  req: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; benchmarkId: string; runId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, benchmarkId, runId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.cancel");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const run = await prisma.benchmarkRun.findFirst({
      where: { id: runId, benchmarkId, benchmark: { projectId } },
      select: { id: true },
    });
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.benchmarkRun.updateMany({
      where: { id: runId, status: { in: ["queued", "running"] } },
      data: { status: "cancelled", completedAt: new Date() },
    });

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "benchmark.run.cancel",
      targetKind: "BenchmarkRun",
      targetId: runId,
      metadata: { viaApi: true },
    });

    return Response.json({ ok: true, run: { id: runId, status: "cancelled" } });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
