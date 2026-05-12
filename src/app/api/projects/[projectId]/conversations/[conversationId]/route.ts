import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; conversationId: string }> },
) {
  const { projectId, conversationId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "conversations.read");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { ordinal: "asc" } },
      validations: { orderBy: { createdAt: "asc" } },
      persona: { select: { id: true, name: true } },
      taxonomyNode: { select: { id: true, name: true, path: true } },
      // For the Settings panel fallback when settingsSnapshot is null (older
      // conversations, or new ones produced by a worker that hasn't picked up
      // the snapshot-writing code yet).
      run: {
        select: {
          id: true,
          name: true,
          model: true,
          samplingParams: true,
          formalityPolicy: true,
          configSnapshot: true,
          providerCredential: { select: { id: true, name: true, kind: true } },
          template: { select: { id: true, name: true, kind: true } },
          languageProfile: {
            select: { id: true, name: true, primary: true, register: true },
          },
        },
      },
    },
  });

  if (!c || c.projectId !== projectId) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      id: c.id,
      status: c.status,
      primaryLanguage: c.primaryLanguage,
      difficulty: c.difficulty,
      persona: c.persona?.name ?? null,
      topic: c.taxonomyNode?.name ?? null,
      settingsSnapshot: c.settingsSnapshot ?? null,
      run: c.run
        ? {
            id: c.run.id,
            name: c.run.name,
            model: c.run.model,
            samplingParams: c.run.samplingParams,
            formalityPolicy: c.run.formalityPolicy,
            configSnapshot: c.run.configSnapshot,
            provider: c.run.providerCredential,
            template: c.run.template,
            languageProfile: c.run.languageProfile,
          }
        : null,
      personaInfo: c.persona,
      taxonomyNode: c.taxonomyNode,
      messages: c.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        reasoningContent: m.reasoningContent,
        ordinal: m.ordinal,
        language: m.language,
        tokenCount: m.tokenCount,
        latencyMs: m.latencyMs,
        model: m.model,
      })),
      validations: c.validations.map((v) => ({
        id: v.id,
        validatorKind: v.validatorKind,
        axis: v.axis,
        verdict: v.verdict,
        score: v.score,
        details: v.details,
      })),
    }),
    {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}
