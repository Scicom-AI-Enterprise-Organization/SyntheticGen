import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { cancelJobTask, executeJob } from "@/lib/synthgen-api";
import { clearJobEvents } from "@/lib/job-event-cache";

export const runtime = "nodejs";

// Bulk re-dispatch EVERY job in this run, including successful ones. The old
// conversations are deleted (cascades to Messages + Validations) so we don't
// accumulate duplicates. Run counters are reset to zero; the worker bumps
// them again as new conversations land.
//
// This is destructive — the caller (UI button) confirms before posting.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  const { projectId, runId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "runs.execute");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const run = await prisma.generationRun.findFirst({
    where: { id: runId, projectId },
    select: { id: true, status: true },
  });
  if (!run) {
    return new Response(JSON.stringify({ error: "run not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // Pull every job in the run, including the succeeded ones.
  const jobs = await prisma.generationJob.findMany({
    where: { runId },
    select: { id: true, conversationId: true },
  });
  if (jobs.length === 0) {
    return Response.json({ ok: true, dispatched: 0, deleted: 0, message: "no jobs" });
  }

  const conversationIds = jobs
    .map((j) => j.conversationId)
    .filter((id): id is string => Boolean(id));

  // Do the destructive bits in a single transaction so a partial failure
  // doesn't leave the run half-reset.
  const reset = await prisma.$transaction(async (tx) => {
    let deleted = 0;
    if (conversationIds.length > 0) {
      // Cascade deletes Messages + Validations; sets GenerationJob.conversationId
      // to null via the existing onDelete: SetNull relation.
      const r = await tx.conversation.deleteMany({
        where: { id: { in: conversationIds }, projectId },
      });
      deleted = r.count;
    }

    await tx.generationJob.updateMany({
      where: { runId },
      data: {
        status: "queued",
        startedAt: null,
        finishedAt: null,
        lastError: null,
        attempts: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: null,
        // conversationId already null via the cascade above; force it for any
        // job whose conversation deletion failed.
        conversationId: null,
      },
    });

    await tx.generationRun.update({
      where: { id: runId },
      data: {
        status: "running",
        producedCount: 0,
        acceptedCount: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        startedAt: new Date(),
        completedAt: null,
      },
    });

    return { deleted };
  });

  // Cancel any leftover asyncio tasks AND clear their event cache buffers
  // BEFORE re-dispatching. Without this, (a) a stale task from the prior
  // attempt could still write back to the row mid-restart, and (b) the
  // cache replays the previous run's user-turn / assistant events on top
  // of the new run's stream when the user opens the preview.
  await Promise.all(
    jobs.map((j) => cancelJobTask(j.id).catch(() => undefined)),
  );
  for (const job of jobs) {
    clearJobEvents(job.id);
  }

  // Fire-and-forget each job's worker dispatch. Sequential rather than
  // Promise.all so a transient worker failure on one call doesn't abort the rest.
  let dispatched = 0;
  const failures: Array<{ jobId: string; error: string }> = [];
  for (const job of jobs) {
    try {
      await executeJob(job.id);
      dispatched++;
    } catch (e) {
      failures.push({ jobId: job.id, error: (e as Error).message ?? "unknown" });
    }
  }

  return Response.json({
    ok: true,
    eligible: jobs.length,
    deleted: reset.deleted,
    dispatched,
    failures,
  });
}
