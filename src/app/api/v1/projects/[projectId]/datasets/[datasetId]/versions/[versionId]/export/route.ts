import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/datasets/:datasetId/versions/:versionId/export
// Download the frozen conversation set of a dataset version. ?format=jsonl
// (default, one conversation per line) or ?format=json (a single JSON array).
// Each record carries metadata + the full ordered messages array.
export async function GET(
  req: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; datasetId: string; versionId: string }>;
  },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, datasetId, versionId } = await params;
    const perm = await checkProjectPermission(user, projectId, "datasets.export");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    // Confirm the version belongs to this dataset + project.
    const version = await prisma.datasetVersion.findFirst({
      where: { id: versionId, datasetId, dataset: { projectId } },
      select: { id: true, version: true, dataset: { select: { name: true } } },
    });
    if (!version) return Response.json({ error: "Not found" }, { status: 404 });

    const format =
      new URL(req.url).searchParams.get("format") === "json" ? "json" : "jsonl";

    const links = await prisma.datasetVersionConversation.findMany({
      where: { datasetVersionId: versionId },
      orderBy: { addedAt: "asc" },
      select: {
        conversation: {
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
        },
      },
    });

    const records = links
      .map((l) => l.conversation)
      .filter((c): c is NonNullable<typeof c> => c != null)
      .map((c) => ({
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

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "dataset.version.export",
      targetKind: "DatasetVersion",
      targetId: versionId,
      metadata: { format, rowCount: records.length, viaApi: true },
    });

    const safeName = version.dataset.name.replace(/[^a-z0-9._-]+/gi, "-");
    const stamp = `${safeName}-v${version.version}`;

    if (format === "json") {
      return new Response(JSON.stringify(records), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${stamp}.json"`,
        },
      });
    }
    const lines = records.map((r) => JSON.stringify(r)).join("\n");
    return new Response(lines, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="${stamp}.jsonl"`,
      },
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
