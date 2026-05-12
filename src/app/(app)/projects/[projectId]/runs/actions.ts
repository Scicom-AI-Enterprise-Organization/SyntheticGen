"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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
  difficulties: z.array(z.string()).min(1),
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
  const totalCells =
    primaryAxis * data.personaIds.length * data.difficulties.length * data.rowsPerCell;
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
  };

  const gridSpec = {
    taxonomyNodeIds: data.taxonomyNodeIds,
    personaIds: data.personaIds,
    difficulties: data.difficulties,
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
      for (const difficulty of data.difficulties) {
        for (let idx = 0; idx < data.rowsPerCell; idx++) {
          jobs.push({
            runId: run.id,
            cellKey: `${primaryKey}:${primaryId}|p:${personaId}|d:${difficulty}|i:${idx}`,
            inputContext: flowMode
              ? { flowId: primaryId, personaId, difficulty, idx }
              : { taxonomyNodeId: primaryId, personaId, difficulty, idx },
          });
        }
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
