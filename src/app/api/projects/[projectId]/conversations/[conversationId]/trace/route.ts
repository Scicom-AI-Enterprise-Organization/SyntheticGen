import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// Returns the full provenance of how a conversation was generated:
//   - Conversation row + every Message (incl. reasoning + rawProviderResponse).
//   - Every Validation with full details.
//   - The GenerationRun.configSnapshot it was produced from (frozen at start).
//   - The GenerationJob row (cellKey, inputContext, attempts, lastError, …).
//   - The Template body it was rendered through.
//   - The Persona + LanguageProfile + Provider (name/kind/baseUrl; NEVER the key).
// Streams as a downloadable JSON file.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; conversationId: string }> },
) {
  const { projectId, conversationId } = await params;
  const wantDownload = new URL(req.url).searchParams.get("download") === "1";
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "conversations.read");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { ordinal: "asc" } },
      validations: { orderBy: { createdAt: "asc" } },
      persona: true,
      taxonomyNode: true,
      run: {
        include: {
          template: true,
          languageProfile: true,
          providerCredential: {
            select: {
              id: true,
              name: true,
              kind: true,
              baseUrl: true,
              defaultModel: true,
              reasoningEffort: true,
              chatTemplateKwargs: true,
              keyFingerprint: true,
            },
          },
        },
      },
    },
  });
  if (!conv || conv.projectId !== projectId) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const job = await prisma.generationJob.findFirst({
    where: { conversationId: conv.id },
    select: {
      id: true,
      cellKey: true,
      inputContext: true,
      attempts: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      latencyMs: true,
      tokensIn: true,
      tokensOut: true,
      costUsd: true,
      lastError: true,
    },
  });

  const events = job
    ? await prisma.jobEvent.findMany({
        where: { jobId: job.id },
        orderBy: { ts: "asc" },
        select: { id: true, ts: true, kind: true, payload: true },
      })
    : [];

  const trace = {
    _schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    projectId,

    conversation: {
      id: conv.id,
      runId: conv.runId,
      status: conv.status,
      primaryLanguage: conv.primaryLanguage,
      primaryScript: conv.primaryScript,
      difficulty: conv.difficulty,
      turnCount: conv.turnCount,
      tokenCount: conv.tokenCount,
      dedupHash: conv.dedupHash,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    },

    messages: conv.messages.map((m) => ({
      id: m.id,
      ordinal: m.ordinal,
      role: m.role,
      content: m.content,
      reasoningContent: m.reasoningContent,
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      language: m.language,
      languageSpans: m.languageSpans,
      script: m.script,
      tokenCount: m.tokenCount,
      latencyMs: m.latencyMs,
      model: m.model,
      rawProviderResponse: m.rawProviderResponse,
      createdAt: m.createdAt,
    })),

    validations: conv.validations.map((v) => ({
      id: v.id,
      validatorKind: v.validatorKind,
      axis: v.axis,
      verdict: v.verdict,
      score: v.score,
      details: v.details,
      createdAt: v.createdAt,
    })),

    persona: conv.persona,
    taxonomyNode: conv.taxonomyNode,

    run: conv.run
      ? {
          id: conv.run.id,
          name: conv.run.name,
          model: conv.run.model,
          status: conv.run.status,
          formalityPolicy: conv.run.formalityPolicy,
          samplingParams: conv.run.samplingParams,
          gridSpec: conv.run.gridSpec,
          configSnapshot: conv.run.configSnapshot,
          template: conv.run.template
            ? {
                id: conv.run.template.id,
                name: conv.run.template.name,
                kind: conv.run.template.kind,
                version: conv.run.template.version,
                description: conv.run.template.description,
                body: conv.run.template.body,
              }
            : null,
          languageProfile: conv.run.languageProfile,
          provider: conv.run.providerCredential, // key is NOT included by the select above.
          targetCount: conv.run.targetCount,
          producedCount: conv.run.producedCount,
          acceptedCount: conv.run.acceptedCount,
          tokensIn: Number(conv.run.tokensIn),
          tokensOut: Number(conv.run.tokensOut),
          costUsd: conv.run.costUsd ? Number(conv.run.costUsd) : 0,
          createdAt: conv.run.createdAt,
          startedAt: conv.run.startedAt,
          completedAt: conv.run.completedAt,
        }
      : null,

    job,
    events,
  };

  // Prisma fields like Decimal / BigInt aren't JSON-serializable by default.
  // Use a replacer so we never throw silently inside JSON.stringify.
  const safeReplacer = (_key: string, value: unknown) => {
    if (typeof value === "bigint") return value.toString();
    if (
      value !== null &&
      typeof value === "object" &&
      "toJSON" in (value as object) &&
      typeof (value as { toJSON: unknown }).toJSON === "function"
    ) {
      try {
        return (value as { toJSON: () => unknown }).toJSON();
      } catch {
        return null;
      }
    }
    return value;
  };

  let body: string;
  try {
    body = JSON.stringify(trace, safeReplacer, 2);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `serialize failed: ${(e as Error).message}` }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (wantDownload) {
    headers["content-disposition"] = `attachment; filename="trace-${conv.id}.json"`;
  }
  return new Response(body, { headers });
}
