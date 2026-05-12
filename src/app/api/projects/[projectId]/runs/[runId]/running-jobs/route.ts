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

  // Return BOTH running and recently-terminal jobs so the Live Job Preview can
  // replay a job's saved tokens after it's already finished. Running jobs are
  // sorted first (live streams), then most-recent terminal jobs.
  const [running, recent] = await Promise.all([
    prisma.generationJob.findMany({
      where: { runId, run: { projectId }, status: "running" },
      select: { id: true, cellKey: true, status: true },
      orderBy: { startedAt: "asc" },
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

  return Response.json({ jobs: [...running, ...recent] });
}
