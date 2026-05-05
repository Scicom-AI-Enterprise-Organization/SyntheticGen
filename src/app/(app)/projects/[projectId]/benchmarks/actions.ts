"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { tryCall } from "@/lib/synthgen-api";

const createBenchmarkSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  // Source URI: hf:<org>/<dataset> or file:<path>. We normalise the leading
  // "hf:" prefix on the form side so users can paste either.
  source: z
    .string()
    .min(3)
    .max(200)
    .regex(/^(hf:[^\/\s]+\/[^\/\s]+|file:.+)$/, "source must be hf:<org>/<dataset> or file:<path>"),
  splits: z.array(z.string().min(1)).min(1),
  maxRowsPerSplit: z.number().int().min(1).max(10000).optional().nullable(),
  // Defaults to function-call kind. Open-ended Json so future kinds can extend.
  config: z.record(z.unknown()).optional().nullable(),
});

export async function createBenchmark(input: z.infer<typeof createBenchmarkSchema>) {
  const parsed = createBenchmarkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.write");

  const config = parsed.data.config ?? {
    kind: "function-call",
    conversationField: "conversation",
    functionsField: "functions",
  };

  const created = await prisma.benchmark.create({
    data: {
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      source: parsed.data.source,
      splits: parsed.data.splits,
      maxRowsPerSplit: parsed.data.maxRowsPerSplit ?? null,
      config: config as unknown as Prisma.InputJsonValue,
      createdById: user.id,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "benchmark.create",
    targetKind: "Benchmark",
    targetId: created.id,
    metadata: { name: created.name, source: created.source },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/benchmarks`);
  return { ok: true, id: created.id };
}

export async function deleteBenchmark(projectId: string, benchmarkId: string) {
  const { user } = await requireProjectPermission(projectId, "benchmarks.write");
  const b = await prisma.benchmark.findUnique({ where: { id: benchmarkId } });
  if (!b || b.projectId !== projectId) return { error: "Benchmark not found" };

  // Block deletion if there are non-completed runs in flight.
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

const startRunSchema = z.object({
  projectId: z.string(),
  benchmarkId: z.string(),
  providerCredentialId: z.string(),
  model: z.string().min(1).max(120),
});

export async function startBenchmarkRun(input: z.infer<typeof startRunSchema>) {
  const parsed = startRunSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.execute");

  const benchmark = await prisma.benchmark.findUnique({
    where: { id: parsed.data.benchmarkId },
    select: { id: true, projectId: true, source: true, name: true },
  });
  if (!benchmark || benchmark.projectId !== parsed.data.projectId) {
    return { error: "Benchmark not found" };
  }

  const provider = await prisma.providerCredential.findUnique({
    where: { id: parsed.data.providerCredentialId },
    select: { projectId: true },
  });
  if (!provider || provider.projectId !== parsed.data.projectId) {
    return { error: "Provider not in this project" };
  }

  const run = await prisma.benchmarkRun.create({
    data: {
      benchmarkId: parsed.data.benchmarkId,
      providerCredentialId: parsed.data.providerCredentialId,
      model: parsed.data.model,
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
    },
  });

  // Tell the Python service to pick it up. The Python worker will fetch the
  // dataset, walk rows, score, and update metrics on this row.
  await tryCall(
    () => fetch(`${process.env.SYNTHGEN_API_URL ?? "http://localhost:8000"}/internal/benchmark-runs/${run.id}/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": process.env.SYNTHGEN_INTERNAL_TOKEN ?? "",
      },
      cache: "no-store",
    }).then((r) => r.json()),
    `start benchmark run ${run.id}`,
  );

  revalidatePath(`/projects/${parsed.data.projectId}/benchmarks/${parsed.data.benchmarkId}`);
  return { ok: true, runId: run.id };
}

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
