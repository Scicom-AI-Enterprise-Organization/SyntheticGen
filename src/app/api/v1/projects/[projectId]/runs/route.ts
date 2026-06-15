import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { startRun, tryCall } from "@/lib/synthgen-api";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/runs?limit=20&status=running
// List recent generation runs for a project the caller has read access to.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "runs.read");
    if (!perm.ok) {
      return Response.json({ error: perm.reason }, { status: 403 });
    }
    const url = new URL(req.url);
    const limit = Math.min(
      Number(url.searchParams.get("limit") ?? "20") || 20,
      200,
    );
    const status = url.searchParams.get("status");
    const runs = await prisma.generationRun.findMany({
      where: {
        projectId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        name: true,
        status: true,
        model: true,
        targetCount: true,
        producedCount: true,
        acceptedCount: true,
        tokensIn: true,
        tokensOut: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        formalityPolicy: true,
      },
    });
    return Response.json({
      runs: runs.map((r) => ({
        ...r,
        tokensIn: Number(r.tokensIn),
        tokensOut: Number(r.tokensOut),
      })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/runs — create + start a generation run.
// Same input shape as the /runs/new wizard; mirrors `createAndStartRun` but
// returns JSON instead of redirecting on success.
const createRunSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional().nullable(),
  templateId: z.string(),
  languageProfileId: z.string(),
  providerCredentialId: z.string(),
  model: z.string().min(1),
  taxonomyNodeIds: z.array(z.string()).default([]),
  personaIds: z.array(z.string()).min(1),
  rowsPerCell: z.number().int().min(1).max(200).default(1),
  turns: z.number().int().min(1).max(20).default(1),
  relatedTopics: z.number().int().min(0).max(6).default(0),
  toolIds: z.array(z.string()).default([]),
  flowIds: z.array(z.string()).default([]),
  formalityPolicy: z
    .enum(["inherit", "formal", "semi-formal", "colloquial", "mixed"])
    .default("inherit"),
  temperature: z.number().min(0).max(2).default(0.7),
  topP: z.number().min(0).max(1).default(1.0),
  maxTokens: z.number().int().min(16).max(64000).default(1024),
  seed: z.number().int().optional().nullable(),
  includeReasoning: z.boolean().default(false),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "runs.execute");
    if (!perm.ok) {
      return Response.json({ error: perm.reason }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const parsed = createRunSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const flowMode = data.flowIds.length > 0;
    if (!flowMode && data.taxonomyNodeIds.length === 0) {
      return Response.json(
        { error: "Pick at least one taxonomy node, or one flow." },
        { status: 400 },
      );
    }
    const primaryAxis = flowMode
      ? data.flowIds.length
      : data.taxonomyNodeIds.length;
    const totalCells = primaryAxis * data.personaIds.length * data.rowsPerCell;
    if (totalCells > 1000) {
      return Response.json(
        {
          error: `Slice 1 caps runs at 1000 cells (this would create ${totalCells}).`,
        },
        { status: 400 },
      );
    }

    const samplingParams = {
      temperature: data.temperature,
      top_p: data.topP,
      max_tokens: data.maxTokens,
      seed: data.seed ?? null,
      turns: data.turns,
      relatedTopics: data.relatedTopics,
      includeReasoning: data.includeReasoning,
    };
    const gridSpec = {
      taxonomyNodeIds: data.taxonomyNodeIds,
      personaIds: data.personaIds,
      rowsPerCell: data.rowsPerCell,
    };
    const configSnapshot = {
      templateId: data.templateId,
      languageProfileId: data.languageProfileId,
      providerCredentialId: data.providerCredentialId,
      model: data.model,
      samplingParams,
      grid: gridSpec,
      formalityPolicy: data.formalityPolicy,
      toolIds: data.toolIds,
      flowIds: data.flowIds,
      validation: { judgeSampleRate: 0 },
    };

    const run = await prisma.generationRun.create({
      data: {
        projectId,
        name: data.name,
        description: data.description ?? null,
        status: "draft",
        configSnapshot,
        providerCredentialId: data.providerCredentialId,
        templateId: data.templateId,
        languageProfileId: data.languageProfileId,
        model: data.model,
        samplingParams,
        gridSpec,
        formalityPolicy: data.formalityPolicy,
        targetCount: totalCells,
        createdById: user.id,
        taxonomyNodes: {
          create: data.taxonomyNodeIds.map((id) => ({ taxonomyNodeId: id })),
        },
        personas: {
          create: data.personaIds.map((id) => ({ personaId: id })),
        },
      },
    });

    const jobs: Array<{ runId: string; cellKey: string; inputContext: object }> =
      [];
    const primaryIds = flowMode ? data.flowIds : data.taxonomyNodeIds;
    const primaryKey = flowMode ? "f" : "t";
    for (const primaryId of primaryIds) {
      for (const personaId of data.personaIds) {
        for (let idx = 0; idx < data.rowsPerCell; idx++) {
          jobs.push({
            runId: run.id,
            cellKey: `${primaryKey}:${primaryId}|p:${personaId}|i:${idx}`,
            inputContext: flowMode
              ? { flowId: primaryId, personaId, idx }
              : { taxonomyNodeId: primaryId, personaId, idx },
          });
        }
      }
    }
    if (jobs.length > 0) {
      await prisma.generationJob.createMany({ data: jobs });
    }

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "run.start",
      targetKind: "GenerationRun",
      targetId: run.id,
      metadata: { name: run.name, targetCount: totalCells, viaApi: true },
    });

    await tryCall(() => startRun(run.id), `start run ${run.id}`);

    return Response.json(
      {
        ok: true,
        run: {
          id: run.id,
          name: run.name,
          status: "queued",
          targetCount: totalCells,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
