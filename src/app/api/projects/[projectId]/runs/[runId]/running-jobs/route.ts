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

  const jobs = await prisma.generationJob.findMany({
    where: { runId, run: { projectId }, status: "running" },
    select: { id: true, cellKey: true },
    orderBy: { startedAt: "asc" },
    take: 32,
  });

  return Response.json({ jobs });
}
