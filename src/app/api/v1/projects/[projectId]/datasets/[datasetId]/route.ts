import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/datasets/:datasetId — dataset + its versions.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; datasetId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, datasetId } = await params;
    const perm = await checkProjectPermission(user, projectId, "datasets.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const d = await prisma.dataset.findFirst({
      where: { id: datasetId, projectId },
      select: {
        id: true,
        name: true,
        description: true,
        currentVersionId: true,
        createdAt: true,
        versions: {
          orderBy: { frozenAt: "desc" },
          select: {
            id: true,
            version: true,
            description: true,
            changelog: true,
            stats: true,
            parentVersionId: true,
            frozenAt: true,
            _count: { select: { conversations: true } },
          },
        },
      },
    });
    if (!d) return Response.json({ error: "Not found" }, { status: 404 });

    return Response.json({
      dataset: {
        id: d.id,
        name: d.name,
        description: d.description,
        currentVersionId: d.currentVersionId,
        createdAt: d.createdAt.toISOString(),
        versions: d.versions.map((v) => ({
          id: v.id,
          version: v.version,
          description: v.description,
          changelog: v.changelog,
          stats: v.stats,
          parentVersionId: v.parentVersionId,
          itemCount: v._count.conversations,
          frozenAt: v.frozenAt.toISOString(),
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
