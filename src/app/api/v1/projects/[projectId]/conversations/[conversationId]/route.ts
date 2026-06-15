import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/conversations/:conversationId — full
// conversation including all messages (with reasoningContent + toolCalls),
// validations, and the frozen settingsSnapshot. Designed for an agent to
// inspect what a synthetic generation produced.
export async function GET(
  req: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; conversationId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, conversationId } = await params;
    const perm = await checkProjectPermission(
      user,
      projectId,
      "conversations.read",
    );
    if (!perm.ok) {
      return Response.json({ error: perm.reason }, { status: 403 });
    }
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, projectId },
      include: {
        messages: {
          orderBy: { ordinal: "asc" },
          select: {
            id: true,
            ordinal: true,
            role: true,
            content: true,
            reasoningContent: true,
            toolCalls: true,
            toolCallId: true,
            language: true,
            tokenCount: true,
            latencyMs: true,
            model: true,
            createdAt: true,
          },
        },
        validations: {
          select: {
            id: true,
            validatorKind: true,
            axis: true,
            verdict: true,
            score: true,
            details: true,
          },
        },
      },
    });
    if (!conv) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({
      conversation: {
        id: conv.id,
        runId: conv.runId,
        status: conv.status,
        primaryLanguage: conv.primaryLanguage,
        difficulty: conv.difficulty,
        turnCount: conv.turnCount,
        tokenCount: conv.tokenCount,
        settingsSnapshot: conv.settingsSnapshot,
        createdAt: conv.createdAt,
        messages: conv.messages,
        validations: conv.validations,
      },
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// PATCH /api/v1/projects/:projectId/conversations/:conversationId
// Curate a conversation: set its review `status` (accept/reject/flag) and/or
// toggle calibration with expected per-axis scores. Mirrors the inline status
// update + the `setCalibration` server action. Requires conversations.annotate.
const patchSchema = z
  .object({
    status: z
      .enum(["generated", "accepted", "rejected", "flagged", "annotated"])
      .optional(),
    isCalibration: z.boolean().optional(),
    // Map of rubric-axis key -> expected human score. null clears it.
    expected: z.record(z.string(), z.number()).optional().nullable(),
  })
  .refine(
    (d) =>
      d.status !== undefined ||
      d.isCalibration !== undefined ||
      d.expected !== undefined,
    { message: "Provide at least one of status, isCalibration, expected" },
  );

export async function PATCH(
  req: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; conversationId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, conversationId } = await params;
    const perm = await checkProjectPermission(
      user,
      projectId,
      "conversations.annotate",
    );
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, projectId },
      select: { id: true },
    });
    if (!conv) return Response.json({ error: "Not found" }, { status: 404 });

    const data: {
      status?: string;
      isCalibration?: boolean;
      calibrationExpected?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    } = {};
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.isCalibration !== undefined)
      data.isCalibration = parsed.data.isCalibration;
    if (parsed.data.expected !== undefined) {
      data.calibrationExpected =
        parsed.data.expected === null
          ? Prisma.JsonNull
          : (parsed.data.expected as Prisma.InputJsonValue);
    }

    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data,
      select: { id: true, status: true, isCalibration: true },
    });

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "conversation.annotate",
      targetKind: "Conversation",
      targetId: conversationId,
      metadata: {
        status: parsed.data.status,
        isCalibration: parsed.data.isCalibration,
        viaApi: true,
      },
    });

    return Response.json({ ok: true, conversation: updated });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE /api/v1/projects/:projectId/conversations/:conversationId
// Mirrors the `deleteConversation` server action, including the frozen-dataset
// guard (a conversation pinned into a DatasetVersion can't be deleted).
export async function DELETE(
  req: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; conversationId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, conversationId } = await params;
    const perm = await checkProjectPermission(
      user,
      projectId,
      "conversations.annotate",
    );
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, projectId },
      select: { id: true },
    });
    if (!conv) return Response.json({ error: "Not found" }, { status: 404 });

    const frozenIn = await prisma.datasetVersionConversation.findFirst({
      where: { conversationId },
      select: {
        datasetVersion: {
          select: { version: true, dataset: { select: { name: true } } },
        },
      },
    });
    if (frozenIn) {
      const v = frozenIn.datasetVersion;
      return Response.json(
        {
          error: `Cannot delete — included in dataset "${v.dataset.name}" v${v.version}. Delete that dataset version first.`,
        },
        { status: 409 },
      );
    }

    try {
      await prisma.conversation.delete({ where: { id: conversationId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2003"
      ) {
        return Response.json(
          { error: "Conversation is referenced elsewhere and can't be deleted." },
          { status: 409 },
        );
      }
      throw e;
    }

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "conversation.delete",
      targetKind: "Conversation",
      targetId: conversationId,
      metadata: { viaApi: true },
    });

    return Response.json({ ok: true, id: conversationId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
