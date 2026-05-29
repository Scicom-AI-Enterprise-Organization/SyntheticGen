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

  // Resolve toolIds in the run's configSnapshot to names, for the Settings
  // panel fallback when settingsSnapshot is null. Newer snapshots already
  // carry `toolNames`; this is only used when the drawer falls back to `run`.
  const cfgToolIds = (() => {
    const cfg = c.run?.configSnapshot as Record<string, unknown> | null | undefined;
    const ids = cfg?.toolIds;
    return Array.isArray(ids) ? (ids.filter((x) => typeof x === "string") as string[]) : [];
  })();
  const toolDefs =
    cfgToolIds.length > 0
      ? await prisma.toolDef.findMany({
          where: { id: { in: cfgToolIds } },
          select: { id: true, name: true },
        })
      : [];

  // Auto-unwrap historical double-encoded snapshots. The worker used to call
  // `json.dumps(settings_snapshot)` AND bind to a `$N::jsonb` param — asyncpg's
  // jsonb codec then re-encoded the already-stringified value, so the column
  // ended up holding `"{\"mode\": \"flow-driven\", ...}"` (a JSON string) instead
  // of the object. The write bug is fixed going forward; unwrap here so the
  // drawer renders existing rows correctly without a DB backfill.
  let settingsSnapshot: unknown = c.settingsSnapshot ?? null;
  if (typeof settingsSnapshot === "string") {
    try {
      settingsSnapshot = JSON.parse(settingsSnapshot);
    } catch {
      settingsSnapshot = null;
    }
  }
  return new Response(
    JSON.stringify({
      id: c.id,
      status: c.status,
      primaryLanguage: c.primaryLanguage,
      difficulty: c.difficulty,
      persona: c.persona?.name ?? null,
      topic: c.taxonomyNode?.name ?? null,
      settingsSnapshot,
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
            toolDefs,
          }
        : null,
      personaInfo: c.persona,
      taxonomyNode: c.taxonomyNode,
      messages: c.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        reasoningContent: m.reasoningContent,
        // When the assistant invokes tools, `content` is usually empty and the
        // actual signal is in `toolCalls`. Include it (plus the matching
        // `toolCallId` on role=tool messages) so the drawer can render the
        // full function-calling exchange.
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
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
