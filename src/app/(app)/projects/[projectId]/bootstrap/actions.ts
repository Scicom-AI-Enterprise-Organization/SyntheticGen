"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { runBootstrap, type BootstrapScope } from "./orchestrator";

const scopeSchema = z.object({
  taxonomy: z.boolean(),
  languages: z.boolean(),
  personas: z.boolean(),
  templates: z.boolean(),
  tools: z.boolean(),
  flows: z.boolean(),
  rubrics: z.boolean(),
  benchmarks: z.boolean(),
});

const startSchema = z.object({
  projectId: z.string(),
  prompt: z.string().min(8).max(4000),
  providerId: z.string(),
  model: z.string().max(200).optional().nullable(),
  // Sampling knobs. Both optional — null means "use the kind default".
  // Match the bounds Python uses so the page can't sneak invalid values in.
  temperature: z.number().min(0).max(2).optional().nullable(),
  maxTokens: z.number().int().min(256).max(64000).optional().nullable(),
  scope: scopeSchema,
});

export async function startBootstrap(input: z.infer<typeof startSchema>) {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { user } = await requireProjectPermission(
    parsed.data.projectId,
    "project.update",
  );

  // Confirm provider belongs to this project.
  const provider = await prisma.providerCredential.findUnique({
    where: { id: parsed.data.providerId },
    select: { projectId: true },
  });
  if (!provider || provider.projectId !== parsed.data.projectId) {
    return { error: "Provider not found in this project" };
  }

  // Refuse if another bootstrap is already in flight for this project — there
  // can be at most one running job at a time per project.
  const running = await prisma.bootstrapJob.findFirst({
    where: {
      projectId: parsed.data.projectId,
      status: { in: ["queued", "running"] },
    },
    select: { id: true },
  });
  if (running) {
    return {
      error:
        "A bootstrap job is already running for this project. Wait for it to finish or cancel it first.",
      runningJobId: running.id,
    };
  }

  const created = await prisma.bootstrapJob.create({
    data: {
      projectId: parsed.data.projectId,
      prompt: parsed.data.prompt.trim(),
      providerId: parsed.data.providerId,
      model: parsed.data.model || null,
      temperature: parsed.data.temperature ?? null,
      maxTokens: parsed.data.maxTokens ?? null,
      scope: parsed.data.scope satisfies BootstrapScope,
      status: "queued",
      createdById: user.id,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "bootstrap.create",
    targetKind: "BootstrapJob",
    targetId: created.id,
    metadata: { scope: parsed.data.scope },
  });

  // Fire-and-forget orchestrator. We deliberately don't await — the action
  // returns immediately and the client subscribes to the SSE stream. Any
  // errors are captured into the job row.
  void runBootstrap(created.id).catch((e) => {
    // Last-ditch logging; the orchestrator already writes failures to the row.
    console.error("[bootstrap] orchestrator crashed:", e);
  });

  revalidatePath(`/projects/${parsed.data.projectId}/bootstrap`);
  return { ok: true as const, id: created.id };
}

// Clones an existing job's prompt/provider/model/scope into a new BootstrapJob
// row and fires the orchestrator on it. Lets the user click "Start another"
// from a completed run and immediately re-generate with the same config.
export async function rerunBootstrap(projectId: string, sourceJobId: string) {
  const { user } = await requireProjectPermission(projectId, "project.update");

  const source = await prisma.bootstrapJob.findFirst({
    where: { id: sourceJobId, projectId },
    select: {
      prompt: true,
      providerId: true,
      model: true,
      temperature: true,
      maxTokens: true,
      scope: true,
    },
  });
  if (!source) return { error: "Source job not found" };

  // Same single-flight guard as startBootstrap — refuse if another bootstrap
  // is already in flight for this project.
  const running = await prisma.bootstrapJob.findFirst({
    where: { projectId, status: { in: ["queued", "running"] } },
    select: { id: true },
  });
  if (running) {
    return {
      error:
        "A bootstrap job is already running for this project. Wait for it to finish or cancel it first.",
      runningJobId: running.id,
    };
  }

  // Confirm the provider still exists in this project. If the original
  // provider was deleted between runs, the rerun is rejected with a clear
  // message instead of failing inside the orchestrator.
  const provider = await prisma.providerCredential.findUnique({
    where: { id: source.providerId },
    select: { projectId: true },
  });
  if (!provider || provider.projectId !== projectId) {
    return {
      error:
        "Original provider is no longer available in this project. Open the start form and pick a new one.",
    };
  }

  const created = await prisma.bootstrapJob.create({
    data: {
      projectId,
      prompt: source.prompt,
      providerId: source.providerId,
      model: source.model,
      temperature: source.temperature,
      maxTokens: source.maxTokens,
      scope: source.scope as Prisma.InputJsonValue,
      status: "queued",
      createdById: user.id,
    },
  });

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "bootstrap.rerun",
    targetKind: "BootstrapJob",
    targetId: created.id,
    metadata: { sourceJobId },
  });

  void runBootstrap(created.id).catch((e) => {
    console.error("[bootstrap] orchestrator crashed:", e);
  });

  revalidatePath(`/projects/${projectId}/bootstrap`);
  return { ok: true as const, id: created.id };
}

export async function cancelBootstrap(projectId: string, jobId: string) {
  const { user } = await requireProjectPermission(projectId, "project.update");

  const job = await prisma.bootstrapJob.findFirst({
    where: { id: jobId, projectId },
    select: { id: true, status: true },
  });
  if (!job) return { error: "Job not found" };
  if (job.status !== "queued" && job.status !== "running") {
    return { error: `Cannot cancel a ${job.status} job` };
  }

  // We don't have a hard interrupt for the orchestrator yet; we mark the row
  // cancelled so the SSE stream closes and the UI stops polling. The current
  // phase will still finish in the background and write its events, but the
  // next phase boundary will see status=cancelled and stop. (Wire that in
  // when we add a heavier orchestrator.)
  await prisma.bootstrapJob.update({
    where: { id: jobId },
    data: { status: "cancelled", completedAt: new Date() },
  });

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "bootstrap.cancel",
    targetKind: "BootstrapJob",
    targetId: jobId,
  });

  revalidatePath(`/projects/${projectId}/bootstrap`);
  return { ok: true };
}

interface InsertedEvent {
  step?: string;
  kind?: string;
  payload?: { entityId?: unknown; name?: unknown };
}

// Pulls every persisted "inserted" event from the job's events array and
// groups the entityIds by step. Items inserted before the entityId field
// existed (older jobs) are returned in `missingIds` so the caller can warn.
function collectIdsByStep(rawEvents: unknown): {
  byStep: Record<string, string[]>;
  missingIds: number;
} {
  const events = Array.isArray(rawEvents) ? (rawEvents as InsertedEvent[]) : [];
  const byStep: Record<string, string[]> = {};
  let missingIds = 0;
  for (const e of events) {
    if (e?.kind !== "inserted") continue;
    const step = typeof e.step === "string" ? e.step : null;
    const id =
      e.payload && typeof e.payload.entityId === "string"
        ? e.payload.entityId
        : null;
    if (!step) continue;
    if (!id) {
      missingIds++;
      continue;
    }
    (byStep[step] ??= []).push(id);
  }
  return { byStep, missingIds };
}

// Counts everything the job inserted across each entity kind. Used by the
// confirm dialog so the user sees "remove 8 nodes, 2 languages, 4 personas…"
// before pulling the trigger. Reads from the same events log so the numbers
// always match what deleteJobGenerations would actually touch.
export async function summarizeJobGenerations(
  projectId: string,
  jobId: string,
): Promise<{
  ok: true;
  counts: Record<string, number>;
  missingIds: number;
} | { error: string }> {
  await requireProjectPermission(projectId, "project.read");
  const job = await prisma.bootstrapJob.findFirst({
    where: { id: jobId, projectId },
    select: { events: true },
  });
  if (!job) return { error: "Job not found" };
  const { byStep, missingIds } = collectIdsByStep(job.events);
  const counts: Record<string, number> = {};
  for (const [step, ids] of Object.entries(byStep)) {
    counts[step] = ids.length;
  }
  return { ok: true, counts, missingIds };
}

interface DeleteOptions {
  // Also wipe the BootstrapJob row itself after deleting its generations.
  deleteJobRow?: boolean;
}

// Removes every entity that this bootstrap job inserted (taxonomy nodes,
// language profiles, personas, templates, tools, flows, rubrics, benchmarks)
// using the IDs persisted in events. Uses deleteMany so already-removed rows
// are tolerated. Optionally also deletes the BootstrapJob row.
export async function deleteJobGenerations(
  projectId: string,
  jobId: string,
  opts: DeleteOptions = {},
) {
  const { user } = await requireProjectPermission(projectId, "project.update");

  const job = await prisma.bootstrapJob.findFirst({
    where: { id: jobId, projectId },
    select: { id: true, status: true, events: true },
  });
  if (!job) return { error: "Job not found" };
  if (job.status === "running" || job.status === "queued") {
    return {
      error:
        "Cancel the job before deleting its generations — it's still inserting.",
    };
  }

  const { byStep, missingIds } = collectIdsByStep(job.events);
  const removed: Record<string, number> = {};

  // The order matters only for foreign-key safety:
  //   benchmarks → rubrics      (Benchmark.defaultRubricId nulls on delete)
  //   personas    → languages   (Persona.languageProfileId nulls on delete)
  //   flows / tools / templates → independent
  //   taxonomy   → independent  (CASCADE handles RunTaxonomyNode etc.)
  // We still wrap in a transaction so a partial delete doesn't leave behind
  // dangling references.
  const ops: Promise<unknown>[] = [];

  if (byStep.benchmarks?.length) {
    ops.push(
      prisma.benchmark
        .deleteMany({
          where: { projectId, id: { in: byStep.benchmarks } },
        })
        .then((r) => {
          removed.benchmarks = r.count;
        }),
    );
  }
  if (byStep.rubrics?.length) {
    ops.push(
      prisma.rubric
        .deleteMany({
          where: { projectId, id: { in: byStep.rubrics } },
        })
        .then((r) => {
          removed.rubrics = r.count;
        }),
    );
  }
  if (byStep.flows?.length) {
    ops.push(
      prisma.flow
        .deleteMany({
          where: { projectId, id: { in: byStep.flows } },
        })
        .then((r) => {
          removed.flows = r.count;
        }),
    );
  }
  if (byStep.tools?.length) {
    ops.push(
      prisma.toolDef
        .deleteMany({
          where: {
            id: { in: byStep.tools },
            catalog: { projectId },
          },
        })
        .then((r) => {
          removed.tools = r.count;
        }),
    );
  }
  if (byStep.templates?.length) {
    ops.push(
      prisma.promptTemplate
        .deleteMany({
          where: { projectId, id: { in: byStep.templates } },
        })
        .then((r) => {
          removed.templates = r.count;
        }),
    );
  }
  if (byStep.personas?.length) {
    ops.push(
      prisma.persona
        .deleteMany({
          where: { projectId, id: { in: byStep.personas } },
        })
        .then((r) => {
          removed.personas = r.count;
        }),
    );
  }
  if (byStep.languages?.length) {
    ops.push(
      prisma.languageProfile
        .deleteMany({
          where: { projectId, id: { in: byStep.languages } },
        })
        .then((r) => {
          removed.languages = r.count;
        }),
    );
  }
  if (byStep.taxonomy?.length) {
    ops.push(
      prisma.taxonomyNode
        .deleteMany({
          where: {
            id: { in: byStep.taxonomy },
            taxonomy: { projectId },
          },
        })
        .then((r) => {
          removed.taxonomy = r.count;
        }),
    );
  }

  await Promise.all(ops);

  if (opts.deleteJobRow) {
    await prisma.bootstrapJob.delete({ where: { id: jobId } });
  }

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: opts.deleteJobRow
      ? "bootstrap.delete-all"
      : "bootstrap.delete-generations",
    targetKind: "BootstrapJob",
    targetId: jobId,
    metadata: { removed, missingIds },
  });

  revalidatePath(`/projects/${projectId}/bootstrap`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const, removed, missingIds };
}
