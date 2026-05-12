import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { executeJob } from "@/lib/synthgen-api";

export const runtime = "nodejs";

// Re-kick a job. Common cases:
//   - status="failed" — previous attempt errored.
//   - status="running" but stuck (worker crash, SSE disconnected mid-stream).
//   - status="queued" but never picked up.
//   - status="succeeded" — user wants to regenerate the conversation.
// For succeeded jobs we orphan (but don't delete) the existing conversation
// so the dataset-version Restrict guard can't bite, and the user keeps the
// old conversation visible in the project archive if they want to compare.
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

  // Reset to queued so the worker's UPDATE→running transition behaves cleanly.
  // Clear conversationId for succeeded re-runs so the new attempt writes a
  // fresh conversation row. Keep attempts so retry pressure stays observable,
  // but clear lastError so the UI doesn't show a stale message.
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "queued",
      startedAt: null,
      finishedAt: null,
      lastError: null,
      conversationId: null,
    },
  });

  // Flip a finalised run back to "running" so RunLiveStatus + LiveJobPreview
  // re-mount and show the re-run's progress. The self-heal block in the run
  // detail page will flip it back to "completed" once the re-run finishes.
  await prisma.generationRun.updateMany({
    where: {
      id: runId,
      status: { in: ["completed", "failed", "cancelled"] },
    },
    data: { status: "running", completedAt: null },
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
