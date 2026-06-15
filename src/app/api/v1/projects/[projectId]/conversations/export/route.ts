import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/conversations/export
// Ad-hoc export of (filtered) conversations as a downloadable file — the v1,
// bearer-authenticated mirror of the dashboard export. Same filters as the
// list endpoint. ?format=jsonl (default) or ?format=json. For an immutable,
// versioned snapshot use the datasets API instead.
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
    const format = sp.get("format") === "json" ? "json" : "jsonl";
    const where: Prisma.ConversationWhereInput = {
      projectId,
      ...(sp.get("runId") ? { runId: sp.get("runId")! } : {}),
      ...(sp.get("status") ? { status: sp.get("status")! } : {}),
      ...(sp.get("topic") ? { taxonomyNodeId: sp.get("topic")! } : {}),
      ...(sp.get("lang") ? { primaryLanguage: sp.get("lang")! } : {}),
      ...(sp.get("personaId") ? { personaId: sp.get("personaId")! } : {}),
    };

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        runId: true,
        primaryLanguage: true,
        primaryScript: true,
        difficulty: true,
        turnCount: true,
        tokenCount: true,
        status: true,
        createdAt: true,
        persona: { select: { name: true, formality: true } },
        taxonomyNode: { select: { name: true, path: true } },
        messages: {
          orderBy: { ordinal: "asc" },
          select: {
            ordinal: true,
            role: true,
            content: true,
            reasoningContent: true,
            toolCalls: true,
            toolCallId: true,
            language: true,
          },
        },
      },
    });

    const records = conversations.map((c) => ({
      id: c.id,
      runId: c.runId,
      primaryLanguage: c.primaryLanguage,
      primaryScript: c.primaryScript,
      difficulty: c.difficulty,
      turnCount: c.turnCount,
      tokenCount: c.tokenCount,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      persona: c.persona,
      topic: c.taxonomyNode,
      messages: c.messages,
    }));

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (format === "json") {
      return new Response(JSON.stringify(records), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="conversations-${stamp}.json"`,
        },
      });
    }
    const lines = records.map((r) => JSON.stringify(r)).join("\n");
    return new Response(lines, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="conversations-${stamp}.jsonl"`,
      },
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
