import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { dispatchBenchmarkRunStart } from "@/lib/benchmark-dispatch";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/benchmarks/:benchmarkId/runs — list runs.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; benchmarkId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, benchmarkId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const benchmark = await prisma.benchmark.findFirst({
      where: { id: benchmarkId, projectId },
      select: { id: true },
    });
    if (!benchmark) return Response.json({ error: "Not found" }, { status: 404 });

    const runs = await prisma.benchmarkRun.findMany({
      where: { benchmarkId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        model: true,
        mode: true,
        rubricId: true,
        ensembleGroupId: true,
        completedTurns: true,
        totalTurns: true,
        failedTurns: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        lastError: true,
      },
    });
    return Response.json({
      runs: runs.map((r) => ({
        ...r,
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/benchmarks/:benchmarkId/runs — start a run.
// Mirrors the `startBenchmarkRun` server action. For project-chat-replay
// benchmarks an ensemble judge group (explicit or the benchmark default) and a
// rubric (explicit or default) are required; create a group via
// POST /ensemble-groups first.
const samplingSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().min(1).max(64000).optional(),
    seed: z.number().int().optional().nullable(),
    judge_temperature: z.number().min(0).max(2).optional(),
    judge_max_tokens: z.number().int().min(1).max(64000).optional(),
    judge_strategy: z.enum(["one-shot", "per-turn"]).optional(),
    judge_max_retries: z.number().int().min(1).max(10).optional(),
    concurrency: z.number().int().min(1).max(32).optional(),
  })
  .optional()
  .nullable();

const startSchema = z.object({
  providerCredentialId: z.string(),
  model: z.string().min(1).max(120),
  ensembleGroupId: z.string().optional().nullable(),
  consensusMethod: z.enum(["median", "mean", "min"]).optional().nullable(),
  rubricId: z.string().optional().nullable(),
  mode: z.enum(["single-turn", "multi-turn"]).optional().nullable(),
  samplingParams: samplingSchema,
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; benchmarkId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, benchmarkId } = await params;
    const perm = await checkProjectPermission(
      user,
      projectId,
      "benchmarks.execute",
    );
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const benchmark = await prisma.benchmark.findFirst({
      where: { id: benchmarkId, projectId },
      select: {
        id: true,
        kind: true,
        name: true,
        defaultRubricId: true,
        defaultEnsembleGroupId: true,
        config: true,
      },
    });
    if (!benchmark) return Response.json({ error: "Not found" }, { status: 404 });

    const provider = await prisma.providerCredential.findUnique({
      where: { id: data.providerCredentialId },
      select: { projectId: true },
    });
    if (!provider || provider.projectId !== projectId) {
      return Response.json(
        { error: "Candidate provider not in this project" },
        { status: 400 },
      );
    }

    let mode: "function-call" | "single-turn" | "multi-turn" = "function-call";
    let judgeProviderCredentialId: string | null = null;
    let judgeModel: string | null = null;
    let rubricId: string | null = null;
    let ensembleGroupId: string | null = null;
    const consensusMethod = data.consensusMethod ?? "median";

    if (benchmark.kind === "project-chat-replay") {
      const configMode =
        benchmark.config &&
        typeof benchmark.config === "object" &&
        "mode" in benchmark.config
          ? (benchmark.config as { mode?: string }).mode ?? "single-turn"
          : "single-turn";
      mode =
        data.mode === "single-turn" || data.mode === "multi-turn"
          ? data.mode
          : configMode === "multi-turn"
            ? "multi-turn"
            : "single-turn";

      const resolvedGroupId =
        data.ensembleGroupId ?? benchmark.defaultEnsembleGroupId ?? null;
      if (!resolvedGroupId) {
        return Response.json(
          {
            error:
              "Chat-replay benchmarks require an ensemble judge group. Create one via POST /ensemble-groups (or set the benchmark default), then pass ensembleGroupId.",
          },
          { status: 400 },
        );
      }
      const group = await prisma.ensembleJudgeGroup.findFirst({
        where: { id: resolvedGroupId, projectId },
        select: { id: true, name: true, judges: true },
      });
      if (!group) {
        return Response.json(
          { error: "Ensemble group not found in this project" },
          { status: 400 },
        );
      }
      const rawJudges = group.judges as unknown;
      const judgesArr = (
        Array.isArray(rawJudges) ? rawJudges : []
      ) as Array<{ providerCredentialId?: string; model?: string }>;
      if (judgesArr.length === 0) {
        return Response.json(
          { error: `Ensemble group "${group.name}" has no judges configured` },
          { status: 400 },
        );
      }
      const providerIds = Array.from(
        new Set(
          judgesArr
            .map((j) => j.providerCredentialId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );
      const ownedProviders = await prisma.providerCredential.findMany({
        where: { id: { in: providerIds }, projectId },
        select: { id: true },
      });
      if (ownedProviders.length !== providerIds.length) {
        return Response.json(
          {
            error: `Ensemble group "${group.name}" references a provider that doesn't belong to this project.`,
          },
          { status: 400 },
        );
      }
      ensembleGroupId = group.id;
      judgeProviderCredentialId = judgesArr[0]?.providerCredentialId ?? null;
      judgeModel = judgesArr[0]?.model ?? null;

      rubricId = data.rubricId ?? benchmark.defaultRubricId ?? null;
      if (!rubricId) {
        return Response.json(
          { error: "No rubric selected and benchmark has no default rubric" },
          { status: 400 },
        );
      }
      const rubric = await prisma.rubric.findFirst({
        where: { id: rubricId, projectId },
        select: { id: true },
      });
      if (!rubric) {
        return Response.json(
          { error: "Rubric not found in this project" },
          { status: 400 },
        );
      }
    }

    const run = await prisma.benchmarkRun.create({
      data: {
        benchmarkId,
        providerCredentialId: data.providerCredentialId,
        model: data.model,
        mode,
        judgeProviderCredentialId,
        judgeModel,
        ensembleGroupId,
        consensusMethod,
        rubricId,
        samplingParams: data.samplingParams
          ? (data.samplingParams as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        status: "queued",
        createdById: user.id,
      },
      select: { id: true },
    });

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "benchmark.run.start",
      targetKind: "BenchmarkRun",
      targetId: run.id,
      metadata: {
        benchmarkId,
        benchmarkName: benchmark.name,
        model: data.model,
        mode,
        ensembleGroupId,
        rubricId,
        viaApi: true,
      },
    });

    const dispatch = await dispatchBenchmarkRunStart(run.id);

    return Response.json(
      {
        ok: true,
        run: { id: run.id, status: "queued", mode },
        ...(dispatch && dispatch.ok
          ? {}
          : {
              warning:
                "Run created + queued, but worker dispatch failed — POST .../restart once the api container is reachable.",
            }),
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
