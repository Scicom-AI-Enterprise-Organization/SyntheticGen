import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/runs/:runId/jobs
// Per-cell generation jobs for a run — the detail behind the run's status
// counts. Each carries its status, attempts, lastError, and resulting
// conversationId. Filter with ?status=failed. Pagination via ?limit/?offset.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, runId } = await params;
    const perm = await checkProjectPermission(user, projectId, "runs.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const run = await prisma.generationRun.findFirst({
      where: { id: runId, projectId },
      select: { id: true },
    });
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });

    const sp = new URL(req.url).searchParams;
    const limit = Math.min(Number(sp.get("limit") ?? "200") || 200, 1000);
    const offset = Math.max(0, Number(sp.get("offset") ?? "0") || 0);
    const status = sp.get("status");

    const where = { runId, ...(status ? { status } : {}) };
    const [total, jobs] = await Promise.all([
      prisma.generationJob.count({ where }),
      prisma.generationJob.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          status: true,
          attempts: true,
          lastError: true,
          cellKey: true,
          conversationId: true,
          inputContext: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return Response.json({
      total,
      limit,
      offset,
      jobs: jobs.map((j) => ({
        ...j,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
