"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export async function deleteConversation(projectId: string, conversationId: string) {
  const { user } = await requireProjectPermission(projectId, "conversations.annotate");

  // Defence in depth: make sure the conversation actually belongs to this project.
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, projectId },
    select: { id: true, runId: true },
  });
  if (!conv) return { error: "Conversation not found in this project" };

  // If this conversation is part of any frozen dataset version, the
  // DatasetVersionConversation FK is `onDelete: Restrict` — Prisma will throw
  // a FK violation. Surface a friendlier error.
  const frozenIn = await prisma.datasetVersionConversation.findFirst({
    where: { conversationId },
    select: {
      datasetVersion: {
        select: { version: true, dataset: { select: { name: true, id: true } } },
      },
    },
  });
  if (frozenIn) {
    const v = frozenIn.datasetVersion;
    return {
      error: `Cannot delete — included in dataset "${v.dataset.name}" v${v.version}. Delete that dataset version first.`,
    };
  }

  try {
    await prisma.conversation.delete({ where: { id: conversationId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return { error: "Conversation is referenced elsewhere and can't be deleted." };
    }
    return { error: (e as Error).message };
  }

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "conversation.delete",
    targetKind: "Conversation",
    targetId: conversationId,
    metadata: { runId: conv.runId },
  });

  revalidatePath(`/projects/${projectId}/conversations`);
  return { ok: true };
}
