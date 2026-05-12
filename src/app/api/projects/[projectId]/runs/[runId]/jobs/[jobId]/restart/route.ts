import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { executeJob } from "@/lib/synthgen-api";

export const runtime = "nodejs";

// Re-kick a job that's not yet succeeded. Common cases:
//   - status="failed" — the previous attempt errored, user wants to retry.
//   - status="running" but stuck (worker crash, SSE disconnected mid-stream).
//   - status="queued" but never picked up (rare; worker hadn't started).
// Refuses jobs already in a terminal-success state (succeeded with conversationId).
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
  const perm = await checkProjectPermission(user, projectId, "runs.execute");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const job = await prisma.generationJob.findFirst({
    where: { id: jobId, runId, run: { projectId } },
    select: { id: true, status: true, conversationId: true },
  });
  if (!job) {
    return new Response(JSON.stringify({ error: "job not found in this run" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  if (job.status === "succeeded" && job.conversationId) {
    return new Response(
      JSON.stringify({ error: "job already succeeded; nothing to restart" }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  }

  // Reset to queued so the worker's UPDATE→running transition behaves cleanly.
  // Keep attempts so retry pressure stays observable, but clear lastError so
  // the UI doesn't show a stale message during the next attempt.
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "queued",
      startedAt: null,
      finishedAt: null,
      lastError: null,
    },
  });

  try {
    const res = await executeJob(jobId);
    return Response.json({ ok: true, jobId, worker: res });
  } catch (e) {
    return Response.json(
      { error: `worker dispatch failed: ${(e as Error).message ?? "unknown"}` },
      { status: 502 },
    );
  }
}
