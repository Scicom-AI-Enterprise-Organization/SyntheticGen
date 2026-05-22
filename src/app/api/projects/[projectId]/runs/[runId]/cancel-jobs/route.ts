import { NextRequest } from "next/server";
import { Client } from "pg";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { cancelJobTask } from "@/lib/synthgen-api";

export const runtime = "nodejs";

// Cancel every non-terminal (pending/queued/running) job in this run without
// touching the run's own status. Use this when you want to stop in-flight
// work but keep the run open for inspection or for a later resume; the
// existing `cancelRun` flow flips the run to `cancelled` and is the right
// choice when you're truly done with it.
//
// Each affected job gets a pg_notify `done` event so any open Live Job
// Preview SSE closes promptly. Same caveat as the per-job and run-level
// cancels: if a chat completion is mid-flight, the API/worker process keeps
// streaming until it returns — we can't interrupt it. The DB row is already
// `cancelled` at that point so user-visible state is correct, and any
// later writeback that tries to set `succeeded` lands on an already
// terminal row.
export async function POST(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ projectId: string; runId: string }>;
  },
) {
  const { projectId, runId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "runs.cancel");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  // Confirm the run belongs to this project so the URL can't be used to
  // reach a run the caller has no permission on.
  const run = await prisma.generationRun.findFirst({
    where: { id: runId, projectId },
    select: { id: true },
  });
  if (!run) {
    return new Response(JSON.stringify({ error: "run not found in this project" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const affected = await prisma.generationJob.findMany({
    where: {
      runId,
      status: { in: ["pending", "queued", "running"] },
    },
    select: { id: true },
  });

  if (affected.length === 0) {
    return Response.json({ ok: true, cancelled: 0 });
  }

  await prisma.generationJob.updateMany({
    where: { id: { in: affected.map((j) => j.id) } },
    data: {
      status: "cancelled",
      finishedAt: new Date(),
      lastError: "Cancelled by user (cancel-jobs)",
    },
  });

  // Cancel each job's asyncio task in the Python api so in-flight LLM
  // calls actually stop, not just the DB row update.
  await Promise.all(
    affected.map((j) => cancelJobTask(j.id).catch(() => undefined)),
  );

  // Emit done events for each cancelled job so the live previews close.
  // Best-effort — failure here just delays the UI close until the 4s
  // status-poll picks up the cancelled state.
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      for (const j of affected) {
        await client.query("SELECT pg_notify('synthgen_job', $1)", [
          JSON.stringify({
            jobId: j.id,
            runId,
            event: "done",
            status: "cancelled",
            reason: "cancel_jobs",
          }),
        ]);
      }
    } catch {
      // ignore
    } finally {
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }

  return Response.json({ ok: true, cancelled: affected.length });
}
