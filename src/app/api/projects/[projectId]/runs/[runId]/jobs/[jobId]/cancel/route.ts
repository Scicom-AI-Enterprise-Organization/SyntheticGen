import { NextRequest } from "next/server";
import { Client } from "pg";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

// Soft-cancel a single job. We mark the row `cancelled` + emit a pg_notify
// `done` event so the Live job preview SSE closes immediately. Note: the
// worker has no mid-LLM-call cancellation hook today — if a chat completion
// is in flight, it will run to completion and then write its result, which
// may overwrite this `cancelled` status with `succeeded`. The cancel still
// gives the user a clean way to stop watching and to signal intent.
export async function POST(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ projectId: string; runId: string; jobId: string }>;
  },
) {
  const { projectId, runId, jobId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "runs.cancel");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const job = await prisma.generationJob.findFirst({
    where: { id: jobId, runId, run: { projectId } },
    select: { id: true, status: true },
  });
  if (!job) {
    return new Response(JSON.stringify({ error: "job not found in this run" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  if (["succeeded", "failed", "cancelled", "skipped"].includes(job.status)) {
    return Response.json({ ok: true, alreadyTerminal: job.status });
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "cancelled",
      finishedAt: new Date(),
      lastError: "Cancelled by user",
    },
  });

  // Pump a `done` event on the synthgen_job channel so any open SSE for this
  // job closes immediately. Best-effort — if pg_notify fails we already
  // updated the row, the UI will fall back to its 3s poll.
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query("SELECT pg_notify('synthgen_job', $1)", [
        JSON.stringify({
          jobId,
          runId,
          event: "done",
          status: "cancelled",
          reason: "user_cancelled",
        }),
      ]);
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

  return Response.json({ ok: true });
}
