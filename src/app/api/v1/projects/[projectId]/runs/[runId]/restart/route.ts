import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { startRun, tryCall } from "@/lib/synthgen-api";

export const runtime = "nodejs";

// POST /api/v1/projects/:projectId/runs/:runId/restart
// Wipes the run's existing conversations + resets every GenerationJob to
// `pending`, then kicks the worker. The run id stays the same — useful when
// you want to re-run the SAME row (e.g. to verify that a worker-side fix
// produces a different result on this run's frozen config).
//
// Refuses while the run is still running/queued — cancel it first via the
// UI or the Python worker's /internal/runs/:id/cancel endpoint. Conversations
// + their messages cascade-delete via the FK.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, runId } = await params;
    const perm = await checkProjectPermission(user, projectId, "runs.execute");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const run = await prisma.generationRun.findFirst({
      where: { id: runId, projectId },
      select: { id: true, status: true, targetCount: true },
    });
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });
    if (run.status === "running" || run.status === "queued") {
      return Response.json(
        {
          error:
            "Run is still in flight — cancel it before restarting (POST /api/v1/projects/<p>/runs/<r>/cancel or click Cancel in the UI).",
        },
        { status: 409 },
      );
    }

    // Wipe + reset in one transaction so a partial failure doesn't leave
    // the run half-restarted. The Conversation cascade FK takes care of
    // Messages + Validations.
    const out = await prisma.$transaction(async (tx) => {
      const removed = await tx.conversation.deleteMany({ where: { runId } });
      const resetJobs = await tx.generationJob.updateMany({
        where: { runId },
        data: {
          status: "pending",
          startedAt: null,
          finishedAt: null,
          lastError: null,
          updatedAt: new Date(),
        },
      });
      await tx.generationRun.update({
        where: { id: runId },
        data: {
          status: "draft",
          producedCount: 0,
          acceptedCount: 0,
          tokensIn: 0,
          tokensOut: 0,
          completedAt: null,
          updatedAt: new Date(),
        },
      });
      return { conversationsDeleted: removed.count, jobsReset: resetJobs.count };
    });

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "run.restart",
      targetKind: "GenerationRun",
      targetId: runId,
      metadata: { ...out, viaApi: true },
    });

    await tryCall(() => startRun(runId), `restart run ${runId}`);

    return Response.json({
      ok: true,
      run: { id: runId, status: "queued" },
      conversationsDeleted: out.conversationsDeleted,
      jobsReset: out.jobsReset,
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
