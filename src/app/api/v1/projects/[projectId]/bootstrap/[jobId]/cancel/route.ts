import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/v1/projects/:projectId/bootstrap/:jobId/cancel
// Mirrors the `cancelBootstrap` server action: flips a queued/running job to
// `cancelled`. There's no hard interrupt — the current phase finishes in the
// background, but the orchestrator bails at the next phase boundary when it
// sees status=cancelled. Refuses on already-terminal jobs.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; jobId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, jobId } = await params;
    const perm = await checkProjectPermission(user, projectId, "project.update");
    if (!perm.ok) {
      return Response.json({ error: perm.reason }, { status: 403 });
    }

    const job = await prisma.bootstrapJob.findFirst({
      where: { id: jobId, projectId },
      select: { id: true, status: true },
    });
    if (!job) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (job.status !== "queued" && job.status !== "running") {
      return Response.json(
        { error: `Cannot cancel a ${job.status} job` },
        { status: 409 },
      );
    }

    await prisma.bootstrapJob.update({
      where: { id: jobId },
      data: { status: "cancelled", completedAt: new Date() },
    });

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "bootstrap.cancel",
      targetKind: "BootstrapJob",
      targetId: jobId,
      metadata: { viaApi: true },
    });

    return Response.json({
      ok: true,
      job: { id: jobId, status: "cancelled" },
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
