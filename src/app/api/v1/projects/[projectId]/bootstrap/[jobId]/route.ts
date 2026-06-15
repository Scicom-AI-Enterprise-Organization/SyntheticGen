import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/bootstrap/:jobId
// Full detail of one bootstrap job — status, scope, per-step inserted counts,
// and the durable `events` trace. Polling this is the API equivalent of the
// UI's SSE stream: an agent can loop until `status` is terminal (completed |
// failed | cancelled) and read the inserted entity ids out of the events.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; jobId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, jobId } = await params;
    const perm = await checkProjectPermission(user, projectId, "project.read");
    if (!perm.ok) {
      return Response.json({ error: perm.reason }, { status: 403 });
    }

    const job = await prisma.bootstrapJob.findFirst({
      where: { id: jobId, projectId },
      select: {
        id: true,
        status: true,
        prompt: true,
        providerId: true,
        model: true,
        scope: true,
        currentStep: true,
        inserted: true,
        events: true,
        error: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });
    if (!job) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json({
      job: {
        id: job.id,
        status: job.status,
        prompt: job.prompt,
        providerId: job.providerId,
        model: job.model,
        scope: (job.scope as Record<string, boolean>) ?? {},
        currentStep: job.currentStep,
        inserted: (job.inserted as Record<string, number>) ?? {},
        error: job.error,
        events: Array.isArray(job.events) ? job.events : [],
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
