import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/runs/:runId — full snapshot of one run
// including configSnapshot, samplingParams, gridSpec, and a small head of
// conversations + jobs. Used by agents to introspect a run's frozen config
// without scraping the HTML page.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, runId } = await params;
    const perm = await checkProjectPermission(user, projectId, "runs.read");
    if (!perm.ok) {
      return Response.json({ error: perm.reason }, { status: 403 });
    }
    const run = await prisma.generationRun.findFirst({
      where: { id: runId, projectId },
      include: {
        taxonomyNodes: { include: { node: { select: { name: true } } } },
        personas: { include: { persona: { select: { name: true } } } },
      },
    });
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });

    const [conversations, jobs] = await Promise.all([
      prisma.conversation.findMany({
        where: { runId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          turnCount: true,
          tokenCount: true,
          primaryLanguage: true,
          createdAt: true,
        },
      }),
      prisma.generationJob.groupBy({
        by: ["status"],
        where: { runId },
        _count: { _all: true },
      }),
    ]);

    return Response.json({
      run: {
        id: run.id,
        name: run.name,
        description: run.description,
        status: run.status,
        model: run.model,
        formalityPolicy: run.formalityPolicy,
        targetCount: run.targetCount,
        producedCount: run.producedCount,
        acceptedCount: run.acceptedCount,
        tokensIn: Number(run.tokensIn),
        tokensOut: Number(run.tokensOut),
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
        samplingParams: run.samplingParams,
        gridSpec: run.gridSpec,
        configSnapshot: run.configSnapshot,
        taxonomyNodeNames: run.taxonomyNodes.map((t) => t.node.name),
        personaNames: run.personas.map((p) => p.persona.name),
      },
      jobCounts: Object.fromEntries(
        jobs.map((j) => [j.status, j._count._all]),
      ),
      conversations,
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
