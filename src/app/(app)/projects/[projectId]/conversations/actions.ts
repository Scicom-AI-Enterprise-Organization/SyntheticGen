"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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

export async function deleteConversations(projectId: string, conversationIds: string[]) {
  const { user } = await requireProjectPermission(projectId, "conversations.annotate");

  if (conversationIds.length === 0) {
    return { okCount: 0, errors: [] as Array<{ id: string; error: string }> };
  }

  // Single scoped lookup to filter out anything not in this project.
  const found = await prisma.conversation.findMany({
    where: { id: { in: conversationIds }, projectId },
    select: { id: true, runId: true },
  });
  const foundIds = new Set(found.map((c) => c.id));

  // Same frozen-dataset guard as the single-delete path, batched.
  const frozen = await prisma.datasetVersionConversation.findMany({
    where: { conversationId: { in: Array.from(foundIds) } },
    select: {
      conversationId: true,
      datasetVersion: {
        select: { version: true, dataset: { select: { name: true } } },
      },
    },
  });
  const frozenById = new Map(frozen.map((f) => [f.conversationId, f]));

  const errors: Array<{ id: string; error: string }> = [];
  let okCount = 0;

  for (const id of conversationIds) {
    if (!foundIds.has(id)) {
      errors.push({ id, error: "Not found in this project" });
      continue;
    }
    const fz = frozenById.get(id);
    if (fz) {
      errors.push({
        id,
        error: `In frozen dataset "${fz.datasetVersion.dataset.name}" v${fz.datasetVersion.version}`,
      });
      continue;
    }
    try {
      await prisma.conversation.delete({ where: { id } });
      okCount += 1;
      const conv = found.find((c) => c.id === id);
      await logAudit({
        projectId,
        actorUserId: user.id,
        action: "conversation.delete",
        targetKind: "Conversation",
        targetId: id,
        metadata: { runId: conv?.runId, bulk: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        errors.push({ id, error: "Referenced elsewhere — can't delete" });
      } else {
        errors.push({ id, error: (e as Error).message });
      }
    }
  }

  if (okCount > 0) revalidatePath(`/projects/${projectId}/conversations`);
  return { okCount, errors };
}

// ─── Calibration set ─────────────────────────────────────────────────
//
// Mark a conversation as a calibration baseline with human-rated
// per-axis scores. Every benchmark run re-judges these and compares
// against the expected scores to detect judge drift.

const calibrationSchema = z.object({
  projectId: z.string(),
  conversationId: z.string(),
  isCalibration: z.boolean(),
  // Map of axis key -> expected human-rated score. Optional when
  // turning calibration OFF, required (or omitted to keep existing)
  // when turning ON.
  expected: z.record(z.string(), z.number()).optional().nullable(),
});

export async function setCalibration(input: z.infer<typeof calibrationSchema>) {
  const parsed = calibrationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "conversations.annotate");

  const conv = await prisma.conversation.findFirst({
    where: { id: parsed.data.conversationId, projectId: parsed.data.projectId },
    select: { id: true, calibrationExpected: true },
  });
  if (!conv) return { error: "Conversation not found in this project" };

  // Build the update payload — preserve existing expected scores when the
  // caller didn't pass any (e.g. they're just toggling the flag off).
  const data: { isCalibration: boolean; calibrationExpected?: Prisma.InputJsonValue | typeof Prisma.JsonNull } = {
    isCalibration: parsed.data.isCalibration,
  };
  if (parsed.data.expected !== undefined) {
    data.calibrationExpected = parsed.data.expected === null
      ? Prisma.JsonNull
      : (parsed.data.expected as Prisma.InputJsonValue);
  }

  await prisma.conversation.update({
    where: { id: parsed.data.conversationId },
    data,
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: parsed.data.isCalibration
      ? "conversation.calibration.mark"
      : "conversation.calibration.unmark",
    targetKind: "Conversation",
    targetId: parsed.data.conversationId,
    metadata: parsed.data.expected ?? undefined,
  });
  revalidatePath(`/projects/${parsed.data.projectId}/conversations`);
  return { ok: true };
}
