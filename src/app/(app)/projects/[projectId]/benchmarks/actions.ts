"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { tryCall } from "@/lib/synthgen-api";

// ───── Create ────────────────────────────────────────────────────────────────

const chatReplayFilterSchema = z.object({
  runIds: z.array(z.string()).optional(),
  personaIds: z.array(z.string()).optional(),
  taxonomyNodeIds: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  seed: z.number().int().optional(),
});

const createBenchmarkSchema = z.object({
  projectId: z.string(),
  // Only chat-replay is exposed from the UI. Kept as an explicit literal so
  // future kinds can extend this without silently changing default behaviour.
  kind: z.literal("project-chat-replay"),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  mode: z.enum(["single-turn", "multi-turn"]),
  filter: chatReplayFilterSchema,
  defaultRubricId: z.string().optional().nullable(),
});

export async function createBenchmark(input: z.infer<typeof createBenchmarkSchema>) {
  const parsed = createBenchmarkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.write");

  // chat-replay: freeze the conversation snapshot at create time.
  const { projectId, filter, defaultRubricId } = parsed.data;
  const where: Prisma.ConversationWhereInput = { projectId };
  if (filter.runIds?.length) where.runId = { in: filter.runIds };
  if (filter.personaIds?.length) where.personaId = { in: filter.personaIds };
  if (filter.taxonomyNodeIds?.length) where.taxonomyNodeId = { in: filter.taxonomyNodeIds };
  if (filter.statuses?.length) where.status = { in: filter.statuses };
  else where.status = "accepted";

  const limit = filter.limit ?? 200;
  // Sample deterministically: order by (createdAt asc, id asc) then slice.
  // True random sampling would need a seed-based approach in SQL; for v1 the
  // user expresses preference via `limit` and the filter. They can re-create
  // the benchmark to re-sample.
  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, primaryLanguage: true },
  });
  if (conversations.length === 0) {
    return { error: "No conversations match the filter — adjust and try again." };
  }
  if (defaultRubricId) {
    const rubric = await prisma.rubric.findFirst({
      where: { id: defaultRubricId, projectId },
      select: { id: true },
    });
    if (!rubric) return { error: "Selected rubric not found in this project" };
  }

  const splits = Array.from(
    new Set(conversations.map((c) => c.primaryLanguage ?? "unknown")),
  ).sort();

  const created = await prisma.benchmark.create({
    data: {
      projectId,
      kind: "project-chat-replay",
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      source:
        filter.runIds?.length === 1
          ? `project-run:${filter.runIds[0]}`
          : "project-filter",
      splits,
      maxRowsPerSplit: null,
      config: {
        kind: "chat-replay",
        mode: parsed.data.mode,
        filter,
      } as unknown as Prisma.InputJsonValue,
      frozenConversationIds: conversations.map((c) => c.id),
      defaultRubricId: defaultRubricId ?? null,
      createdById: user.id,
    },
  });

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "benchmark.create",
    targetKind: "Benchmark",
    targetId: created.id,
    metadata: {
      name: created.name,
      kind: "project-chat-replay",
      mode: parsed.data.mode,
      itemCount: conversations.length,
      rubricId: defaultRubricId ?? null,
    },
  });

  revalidatePath(`/projects/${projectId}/benchmarks`);
  return { ok: true, id: created.id };
}

// ───── Delete ────────────────────────────────────────────────────────────────

export async function deleteBenchmark(projectId: string, benchmarkId: string) {
  const { user } = await requireProjectPermission(projectId, "benchmarks.write");
  const b = await prisma.benchmark.findUnique({ where: { id: benchmarkId } });
  if (!b || b.projectId !== projectId) return { error: "Benchmark not found" };

  const liveRuns = await prisma.benchmarkRun.count({
    where: { benchmarkId, status: { in: ["queued", "running"] } },
  });
  if (liveRuns > 0) {
    return { error: `Cannot delete: ${liveRuns} run(s) still in flight. Cancel them first.` };
  }

  await prisma.benchmark.delete({ where: { id: benchmarkId } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "benchmark.delete",
    targetKind: "Benchmark",
    targetId: benchmarkId,
  });
  revalidatePath(`/projects/${projectId}/benchmarks`);
  return { ok: true };
}

// ───── Start run ─────────────────────────────────────────────────────────────

const startRunSchema = z.object({
  projectId: z.string(),
  benchmarkId: z.string(),
  // Candidate
  providerCredentialId: z.string(),
  model: z.string().min(1).max(120),
  // Chat-replay-only fields; ignored for hf-function-call benchmarks.
  judgeProviderCredentialId: z.string().optional().nullable(),
  judgeModel: z.string().min(1).max(120).optional().nullable(),
  rubricId: z.string().optional().nullable(),
  mode: z.enum(["single-turn", "multi-turn"]).optional().nullable(),
  samplingParams: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      top_p: z.number().min(0).max(1).optional(),
      max_tokens: z.number().int().min(1).max(64000).optional(),
      seed: z.number().int().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export async function startBenchmarkRun(input: z.infer<typeof startRunSchema>) {
  const parsed = startRunSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.execute");

  const benchmark = await prisma.benchmark.findUnique({
    where: { id: parsed.data.benchmarkId },
    select: {
      id: true,
      projectId: true,
      kind: true,
      source: true,
      name: true,
      defaultRubricId: true,
      config: true,
    },
  });
  if (!benchmark || benchmark.projectId !== parsed.data.projectId) {
    return { error: "Benchmark not found" };
  }

  const provider = await prisma.providerCredential.findUnique({
    where: { id: parsed.data.providerCredentialId },
    select: { projectId: true },
  });
  if (!provider || provider.projectId !== parsed.data.projectId) {
    return { error: "Candidate provider not in this project" };
  }

  let mode: "function-call" | "single-turn" | "multi-turn" = "function-call";
  let judgeProviderCredentialId: string | null = null;
  let judgeModel: string | null = null;
  let rubricId: string | null = null;

  if (benchmark.kind === "project-chat-replay") {
    // Chat-replay needs a judge + rubric. Fall back to the benchmark's
    // configured defaults if the form didn't override them.
    const configMode =
      benchmark.config && typeof benchmark.config === "object" && "mode" in benchmark.config
        ? ((benchmark.config as { mode?: string }).mode ?? "single-turn")
        : "single-turn";
    mode =
      parsed.data.mode === "single-turn" || parsed.data.mode === "multi-turn"
        ? parsed.data.mode
        : (configMode === "multi-turn" ? "multi-turn" : "single-turn");

    if (!parsed.data.judgeProviderCredentialId || !parsed.data.judgeModel) {
      return { error: "Chat-replay benchmarks require a judge provider and model" };
    }
    const judgeProvider = await prisma.providerCredential.findUnique({
      where: { id: parsed.data.judgeProviderCredentialId },
      select: { projectId: true },
    });
    if (!judgeProvider || judgeProvider.projectId !== parsed.data.projectId) {
      return { error: "Judge provider not in this project" };
    }
    judgeProviderCredentialId = parsed.data.judgeProviderCredentialId;
    judgeModel = parsed.data.judgeModel;

    rubricId = parsed.data.rubricId ?? benchmark.defaultRubricId ?? null;
    if (!rubricId) {
      return { error: "No rubric selected and benchmark has no default rubric" };
    }
    const rubric = await prisma.rubric.findFirst({
      where: { id: rubricId, projectId: parsed.data.projectId },
      select: { id: true },
    });
    if (!rubric) return { error: "Rubric not found in this project" };
  }

  const run = await prisma.benchmarkRun.create({
    data: {
      benchmarkId: parsed.data.benchmarkId,
      providerCredentialId: parsed.data.providerCredentialId,
      model: parsed.data.model,
      mode,
      judgeProviderCredentialId,
      judgeModel,
      rubricId,
      samplingParams: parsed.data.samplingParams
        ? (parsed.data.samplingParams as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      status: "queued",
      createdById: user.id,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "benchmark.run.start",
    targetKind: "BenchmarkRun",
    targetId: run.id,
    metadata: {
      benchmarkId: benchmark.id,
      benchmarkName: benchmark.name,
      model: parsed.data.model,
      mode,
      judgeModel,
      rubricId,
    },
  });

  await tryCall(
    () =>
      fetch(
        `${process.env.SYNTHGEN_API_URL ?? "http://localhost:8000"}/internal/benchmark-runs/${run.id}/start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": process.env.SYNTHGEN_INTERNAL_TOKEN ?? "",
          },
          cache: "no-store",
        },
      ).then((r) => r.json()),
    `start benchmark run ${run.id}`,
  );

  revalidatePath(`/projects/${parsed.data.projectId}/benchmarks/${parsed.data.benchmarkId}`);
  return { ok: true, runId: run.id };
}

// ───── Cancel ────────────────────────────────────────────────────────────────

export async function cancelBenchmarkRun(projectId: string, runId: string) {
  const { user } = await requireProjectPermission(projectId, "benchmarks.cancel");
  await prisma.benchmarkRun.updateMany({
    where: { id: runId, status: { in: ["queued", "running"] } },
    data: { status: "cancelled", completedAt: new Date() },
  });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "benchmark.run.cancel",
    targetKind: "BenchmarkRun",
    targetId: runId,
  });
  revalidatePath(`/projects/${projectId}/benchmarks`);
  return { ok: true };
}
