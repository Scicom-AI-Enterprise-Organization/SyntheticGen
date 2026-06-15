import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { startRun, tryCall } from "@/lib/synthgen-api";

export const runtime = "nodejs";

// POST /api/v1/projects/:projectId/runs/:runId/replicate
// Clones the run's frozen config (provider, template, sampling, scope, tools,
// flows, etc.) into a NEW GenerationRun + its GenerationJobs and starts the
// worker on it. Mirrors `replicateRunAction` from the UI's Replicate dropdown.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, runId } = await params;
    const perm = await checkProjectPermission(user, projectId, "runs.execute");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const source = await prisma.generationRun.findFirst({
      where: { id: runId, projectId },
      include: { taxonomyNodes: true, personas: true },
    });
    if (!source) {
      return Response.json({ error: "Source run not found" }, { status: 404 });
    }
    const provider = source.providerCredentialId
      ? await prisma.providerCredential.findUnique({
          where: { id: source.providerCredentialId },
          select: { projectId: true },
        })
      : null;
    if (!provider || provider.projectId !== projectId) {
      return Response.json(
        {
          error:
            "Original provider is no longer available — re-create the run via /runs and pick a new provider.",
        },
        { status: 409 },
      );
    }

    const cfg = (source.configSnapshot ?? {}) as Record<string, unknown>;
    const flowIds = Array.isArray(cfg.flowIds)
      ? (cfg.flowIds as string[]).filter((v): v is string => typeof v === "string")
      : [];
    const grid = (source.gridSpec ?? {}) as Record<string, unknown>;
    const rowsPerCell =
      typeof grid.rowsPerCell === "number" ? grid.rowsPerCell : 1;
    const taxonomyNodeIds = source.taxonomyNodes.map((t) => t.taxonomyNodeId);
    const personaIds = source.personas.map((p) => p.personaId);
    const flowMode = flowIds.length > 0;
    const primaryIds = flowMode ? flowIds : taxonomyNodeIds;
    const primaryKey = flowMode ? "f" : "t";
    const totalCells = primaryIds.length * personaIds.length * rowsPerCell;

    const body = (await req.json().catch(() => ({}))) as {
      name?: string | null;
    };
    const customName =
      typeof body?.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : null;

    const created = await prisma.generationRun.create({
      data: {
        projectId,
        name: customName ?? `${source.name} (copy)`,
        description: source.description,
        status: "draft",
        configSnapshot: source.configSnapshot as Prisma.InputJsonValue,
        providerCredentialId: source.providerCredentialId,
        templateId: source.templateId,
        languageProfileId: source.languageProfileId,
        model: source.model,
        samplingParams: source.samplingParams as Prisma.InputJsonValue,
        gridSpec: source.gridSpec as Prisma.InputJsonValue,
        formalityPolicy: source.formalityPolicy,
        targetCount: totalCells,
        createdById: user.id,
        taxonomyNodes: {
          create: taxonomyNodeIds.map((id) => ({ taxonomyNodeId: id })),
        },
        personas: { create: personaIds.map((id) => ({ personaId: id })) },
      },
    });

    const jobs: Array<{ runId: string; cellKey: string; inputContext: object }> =
      [];
    for (const primaryId of primaryIds) {
      for (const personaId of personaIds) {
        for (let idx = 0; idx < rowsPerCell; idx++) {
          jobs.push({
            runId: created.id,
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
      action: "run.replicate",
      targetKind: "GenerationRun",
      targetId: created.id,
      metadata: {
        sourceRunId: runId,
        name: created.name,
        targetCount: totalCells,
        viaApi: true,
      },
    });

    await tryCall(() => startRun(created.id), `start run ${created.id}`);

    return Response.json(
      {
        ok: true,
        run: {
          id: created.id,
          name: created.name,
          status: "queued",
          targetCount: totalCells,
        },
        sourceRunId: runId,
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
