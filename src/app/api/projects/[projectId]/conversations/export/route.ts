import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// Streams the project's conversations as a downloadable JSONL file. Each line
// is one conversation: id, metadata, persona/topic snapshots, and the full
// messages array. Respects the same filters as the list page (run/status/
// topic/language) so users can scope the export to whatever they're viewing.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "conversations.read");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const sp = new URL(req.url).searchParams;
  const where: Prisma.ConversationWhereInput = {
    projectId,
    ...(sp.get("runId") ? { runId: sp.get("runId")! } : {}),
    ...(sp.get("status") ? { status: sp.get("status")! } : {}),
    ...(sp.get("topic") ? { taxonomyNodeId: sp.get("topic")! } : {}),
    ...(sp.get("lang") ? { primaryLanguage: sp.get("lang")! } : {}),
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

  const lines = conversations
    .map((c) => JSON.stringify({
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
    }))
    .join("\n");

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new Response(lines, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="conversations-${stamp}.jsonl"`,
    },
  });
}
