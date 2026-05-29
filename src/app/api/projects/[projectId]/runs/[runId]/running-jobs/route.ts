import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  const { projectId, runId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "runs.read");
  if (!perm.ok) {
    return Response.json({ error: perm.reason }, { status: 403 });
  }

  // Return active (running + queued + pending) AND recently-terminal jobs so
  // the Live Job Preview can replay saved tokens after a job finishes AND
  // surface jobs that were just restarted (which sit in `queued` until a
  // worker picks them up — without including queued here, restart looked
  // like a no-op because the job vanished from the tile list).
  const [active, recent] = await Promise.all([
    prisma.generationJob.findMany({
      where: {
        runId,
        run: { projectId },
        status: { in: ["running", "queued", "pending"] },
      },
      select: { id: true, cellKey: true, status: true },
      orderBy: [{ startedAt: "asc" }, { createdAt: "desc" }],
      take: 32,
    }),
    prisma.generationJob.findMany({
      where: {
        runId,
        run: { projectId },
        status: { in: ["succeeded", "failed", "cancelled", "skipped"] },
      },
      select: { id: true, cellKey: true, status: true },
      orderBy: { finishedAt: "desc" },
      take: 32,
    }),
  ]);

  return Response.json({ jobs: [...active, ...recent] });
}
