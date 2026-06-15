import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/benchmarks/:benchmarkId — detail + recent runs.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; benchmarkId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, benchmarkId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const b = await prisma.benchmark.findFirst({
      where: { id: benchmarkId, projectId },
      select: {
        id: true,
        name: true,
        description: true,
        kind: true,
        source: true,
        splits: true,
        frozenConversationIds: true,
        defaultRubricId: true,
        defaultEnsembleGroupId: true,
        config: true,
        createdAt: true,
        runs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            status: true,
            model: true,
            mode: true,
            completedTurns: true,
            totalTurns: true,
            failedTurns: true,
            createdAt: true,
            completedAt: true,
          },
        },
      },
    });
    if (!b) return Response.json({ error: "Not found" }, { status: 404 });

    return Response.json({
      benchmark: {
        id: b.id,
        name: b.name,
        description: b.description,
        kind: b.kind,
        source: b.source,
        splits: b.splits,
        mode:
          b.config && typeof b.config === "object" && "mode" in b.config
            ? (b.config as { mode?: string }).mode ?? null
            : null,
        itemCount: b.frozenConversationIds.length,
        defaultRubricId: b.defaultRubricId,
        defaultEnsembleGroupId: b.defaultEnsembleGroupId,
        createdAt: b.createdAt.toISOString(),
        runs: b.runs.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          completedAt: r.completedAt?.toISOString() ?? null,
        })),
      },
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE /api/v1/projects/:projectId/benchmarks/:benchmarkId — delete a
// benchmark (cascades its runs + results). Refuses while a run is in flight.
// Mirrors the `deleteBenchmark` server action.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; benchmarkId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, benchmarkId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const b = await prisma.benchmark.findFirst({
      where: { id: benchmarkId, projectId },
      select: { id: true },
    });
    if (!b) return Response.json({ error: "Not found" }, { status: 404 });

    const liveRuns = await prisma.benchmarkRun.count({
      where: { benchmarkId, status: { in: ["queued", "running"] } },
    });
    if (liveRuns > 0) {
      return Response.json(
        {
          error: `Cannot delete: ${liveRuns} run(s) still in flight. Cancel them first.`,
        },
        { status: 409 },
      );
    }

    await prisma.benchmark.delete({ where: { id: benchmarkId } });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "benchmark.delete",
      targetKind: "Benchmark",
      targetId: benchmarkId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, id: benchmarkId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
