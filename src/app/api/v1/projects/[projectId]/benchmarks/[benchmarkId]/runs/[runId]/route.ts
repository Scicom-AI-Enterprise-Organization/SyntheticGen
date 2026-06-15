import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/benchmarks/:benchmarkId/runs/:runId
// Run detail: status, candidate model, judge config, live counters, aggregate
// metrics, and a count of results grouped by verdict.
export async function GET(
  req: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; benchmarkId: string; runId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, benchmarkId, runId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const run = await prisma.benchmarkRun.findFirst({
      where: { id: runId, benchmarkId, benchmark: { projectId } },
      select: {
        id: true,
        benchmarkId: true,
        status: true,
        model: true,
        mode: true,
        judgeModel: true,
        ensembleGroupId: true,
        consensusMethod: true,
        rubricId: true,
        samplingParams: true,
        metrics: true,
        calibrationReport: true,
        totalTurns: true,
        completedTurns: true,
        failedTurns: true,
        tokensIn: true,
        tokensOut: true,
        costUsd: true,
        startedAt: true,
        completedAt: true,
        lastError: true,
        createdAt: true,
      },
    });
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });

    const verdicts = await prisma.benchmarkResult.groupBy({
      by: ["judgeVerdict"],
      where: { runId },
      _count: { _all: true },
    });
    const verdictCounts: Record<string, number> = {};
    for (const v of verdicts) {
      verdictCounts[v.judgeVerdict ?? "(none)"] = v._count._all;
    }

    return Response.json({
      run: {
        ...run,
        tokensIn: Number(run.tokensIn),
        tokensOut: Number(run.tokensOut),
        costUsd: run.costUsd != null ? Number(run.costUsd) : null,
        startedAt: run.startedAt?.toISOString() ?? null,
        completedAt: run.completedAt?.toISOString() ?? null,
        createdAt: run.createdAt.toISOString(),
      },
      verdictCounts,
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
