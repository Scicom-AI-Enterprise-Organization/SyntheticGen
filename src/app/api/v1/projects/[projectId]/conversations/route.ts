import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/conversations
// Paginated, filterable list of project conversations (summary rows — use the
// /:conversationId endpoint for full messages). Filters mirror the UI list +
// export: ?runId, ?status, ?topic (taxonomyNodeId), ?lang (primaryLanguage),
// ?personaId, ?calibration=true. Pagination: ?limit (default 50, max 500),
// ?offset.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "conversations.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const sp = new URL(req.url).searchParams;
    const limit = Math.min(Number(sp.get("limit") ?? "50") || 50, 500);
    const offset = Math.max(0, Number(sp.get("offset") ?? "0") || 0);

    const where: Prisma.ConversationWhereInput = {
      projectId,
      ...(sp.get("runId") ? { runId: sp.get("runId")! } : {}),
      ...(sp.get("status") ? { status: sp.get("status")! } : {}),
      ...(sp.get("topic") ? { taxonomyNodeId: sp.get("topic")! } : {}),
      ...(sp.get("lang") ? { primaryLanguage: sp.get("lang")! } : {}),
      ...(sp.get("personaId") ? { personaId: sp.get("personaId")! } : {}),
      ...(sp.get("calibration") === "true" ? { isCalibration: true } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.conversation.count({ where }),
      prisma.conversation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          runId: true,
          status: true,
          primaryLanguage: true,
          primaryScript: true,
          difficulty: true,
          turnCount: true,
          tokenCount: true,
          personaId: true,
          taxonomyNodeId: true,
          isCalibration: true,
          createdAt: true,
        },
      }),
    ]);

    return Response.json({
      total,
      limit,
      offset,
      conversations: rows.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
