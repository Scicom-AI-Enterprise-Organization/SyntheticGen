"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { startRun, cancelRun, tryCall } from "@/lib/synthgen-api";

const startRunSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional().nullable(),
  templateId: z.string(),
  languageProfileId: z.string(),
  providerCredentialId: z.string(),
  model: z.string().min(1),
  taxonomyNodeIds: z.array(z.string()),
  personaIds: z.array(z.string()).min(1),
  rowsPerCell: z.number().int().min(1).max(200),
  turns: z.number().int().min(1).max(20).default(1),
  relatedTopics: z.number().int().min(0).max(6).default(0),
  toolIds: z.array(z.string()).default([]),
  flowIds: z.array(z.string()).default([]),
  formalityPolicy: z.enum(["inherit", "formal", "semi-formal", "colloquial", "mixed"]).default("inherit"),
  temperature: z.number().min(0).max(2).default(0.7),
  topP: z.number().min(0).max(1).default(1.0),
  maxTokens: z.number().int().min(16).max(64000).default(1024),
  seed: z.number().int().optional().nullable(),
  // When true, the worker forces `enable_thinking=true` on every assistant
  // turn so the Message.reasoningContent column is populated. Lets a project
  // get reasoning per turn even when the provider's default chatTemplateKwargs
  // would otherwise suppress it.
  includeReasoning: z.boolean().default(false),
});

export async function createAndStartRun(input: z.infer<typeof startRunSchema>) {
  const parsed = startRunSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  const { user } = await requireProjectPermission(data.projectId, "runs.execute");

  const flowMode = data.flowIds.length > 0;
  if (!flowMode && data.taxonomyNodeIds.length === 0) {
    return { error: "Pick at least one taxonomy node, or one flow." };
  }

  const primaryAxis = flowMode ? data.flowIds.length : data.taxonomyNodeIds.length;
  const totalCells = primaryAxis * data.personaIds.length * data.rowsPerCell;
  if (totalCells > 1000) {
    return { error: `Slice 1 caps runs at 1000 cells (this would create ${totalCells}).` };
  }

  // Build the snapshot of the run config — frozen at start.
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
    validation: { judgeSampleRate: 0 }, // slice 1: no judge
  };

  const run = await prisma.generationRun.create({
    data: {
      projectId: data.projectId,
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

  // Materialize the grid into GenerationJob rows in batched insertMany.
  // The primary axis is taxonomy nodes by default, or flows when the run
  // is in flow mode (the flow owns its own topic / tool wiring).
  const jobs: Array<{
    runId: string;
    cellKey: string;
    inputContext: object;
  }> = [];
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
  // createMany doesn't support relations; flat object is fine.
  await prisma.generationJob.createMany({ data: jobs });

  await logAudit({
    projectId: data.projectId,
    actorUserId: user.id,
    action: "run.start",
    targetKind: "GenerationRun",
    targetId: run.id,
    metadata: { name: run.name, targetCount: totalCells },
  });

  // Tell Python to start picking up jobs (also sets status -> queued).
  await tryCall(() => startRun(run.id), `start run ${run.id}`);

  revalidatePath(`/projects/${data.projectId}/runs`);
  redirect(`/projects/${data.projectId}/runs/${run.id}`);
}

// Clones the run's frozen config (provider, template, sampling, scope, tools,
// flows, etc.) into a NEW GenerationRun + its GenerationJobs and starts the
// worker on it. Same shape as createAndStartRun, but seeded from the source
// row instead of a form submit. Used by the "Replicate as-is" dropdown item
// on the run detail page.
export async function replicateRunAction(
  projectId: string,
  sourceRunId: string,
) {
  const { user } = await requireProjectPermission(projectId, "runs.execute");

  const source = await prisma.generationRun.findFirst({
    where: { id: sourceRunId, projectId },
    include: { taxonomyNodes: true, personas: true },
  });
  if (!source) return { error: "Source run not found" };

  // Confirm the provider still exists in this project. If the provider was
  // archived/deleted between runs, surface a clear error.
  const provider = await prisma.providerCredential.findUnique({
    where: { id: source.providerCredentialId ?? "" },
    select: { projectId: true },
  });
  if (!provider || provider.projectId !== projectId) {
    return {
      error:
        "Original provider is no longer available — open the start form and pick a new one.",
    };
  }

  const cfg = (source.configSnapshot ?? {}) as Record<string, unknown>;
  const toolIds = Array.isArray(cfg.toolIds)
    ? (cfg.toolIds as string[]).filter((v): v is string => typeof v === "string")
    : [];
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

  const created = await prisma.generationRun.create({
    data: {
      projectId,
      name: `${source.name} (copy)`,
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
      personas: {
        create: personaIds.map((id) => ({ personaId: id })),
      },
    },
  });

  const jobs: Array<{ runId: string; cellKey: string; inputContext: object }> = [];
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
    metadata: { sourceRunId, name: created.name, targetCount: totalCells },
  });

  await tryCall(() => startRun(created.id), `start run ${created.id}`);

  // Touch toolIds so the variable isn't flagged as unused — we preserved
  // the config snapshot wholesale, but tools live inside `configSnapshot`
  // rather than as relations, so there's nothing else to copy here.
  void toolIds;

  revalidatePath(`/projects/${projectId}/runs`);
  redirect(`/projects/${projectId}/runs/${created.id}`);
}

export async function cancelRunAction(projectId: string, runId: string) {
  const { user } = await requireProjectPermission(projectId, "runs.cancel");
  await tryCall(() => cancelRun(runId), `cancel run ${runId}`);
  // Also defensive update locally in case Python is offline.
  await prisma.generationRun.updateMany({
    where: { id: runId, status: { in: ["queued", "running", "paused"] } },
    data: { status: "cancelled", completedAt: new Date() },
  });
  await prisma.generationJob.updateMany({
    where: { runId, status: "pending" },
    data: { status: "skipped" },
  });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "run.cancel",
    targetKind: "GenerationRun",
    targetId: runId,
  });
  revalidatePath(`/projects/${projectId}/runs/${runId}`);
  return { ok: true };
}
