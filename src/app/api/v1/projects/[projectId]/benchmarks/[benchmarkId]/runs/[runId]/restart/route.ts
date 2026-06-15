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

// POST /api/v1/projects/:projectId/benchmarks/:benchmarkId/runs/:runId/restart
// Reset a benchmark run to queued and re-dispatch. Body { mode } selects:
//   "fresh"  (default) — wipe every BenchmarkResult and re-judge from scratch.
//   "resume"           — keep existing results, only judge unjudged rows.
// Mirrors `restartBenchmarkRun`.
const schema = z.object({
  mode: z.enum(["fresh", "resume"]).default("fresh"),
});

export async function POST(
  req: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; benchmarkId: string; runId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, benchmarkId, runId } = await params;
    const perm = await checkProjectPermission(
      user,
      projectId,
      "benchmarks.execute",
    );
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) ?? {};
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const mode = parsed.data.mode;

    const run = await prisma.benchmarkRun.findFirst({
      where: { id: runId, benchmarkId, benchmark: { projectId } },
      select: { id: true },
    });
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });

    if (mode === "fresh") {
      await prisma.$transaction(async (tx) => {
        await tx.benchmarkResult.deleteMany({ where: { runId } });
        await tx.benchmarkRun.update({
          where: { id: runId },
          data: {
            status: "queued",
            startedAt: null,
            completedAt: null,
            lastError: null,
            completedTurns: 0,
            failedTurns: 0,
            totalTurns: 0,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            metrics: Prisma.JsonNull,
          },
        });
      });
    } else {
      await prisma.benchmarkRun.update({
        where: { id: runId },
        data: { status: "queued", completedAt: null, lastError: null },
      });
    }

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: mode === "fresh" ? "benchmark.run.restart" : "benchmark.run.resume",
      targetKind: "BenchmarkRun",
      targetId: runId,
      metadata: { viaApi: true },
    });

    const dispatch = await dispatchBenchmarkRunStart(runId);

    return Response.json({
      ok: true,
      run: { id: runId, status: "queued" },
      mode,
      ...(dispatch && dispatch.ok
        ? {}
        : {
            warning:
              "Run reset to queued, but worker dispatch failed — retry once the api container is reachable.",
          }),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
