import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

// Pinned to Node runtime — Prisma + long-lived TCP keepalives don't fit Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> },
) {
  const { projectId, runId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "runs.read");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const ABORT_TIMEOUT_MS = 5 * 60 * 1000;
  const POLL_INTERVAL_MS = 1500;

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      let lastSig = "";

      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      // Initial heartbeat so the EventSource knows the connection is open.
      send({ kind: "open", runId });

      const interval = setInterval(async () => {
        try {
          const [run, jobs] = await Promise.all([
            prisma.generationRun.findUnique({
              where: { id: runId },
              select: {
                status: true,
                producedCount: true,
                targetCount: true,
                acceptedCount: true,
                tokensIn: true,
                tokensOut: true,
                costUsd: true,
              },
            }),
            prisma.generationJob.groupBy({
              by: ["status"],
              where: { runId },
              _count: { _all: true },
            }),
          ]);
          if (!run) {
            send({ kind: "error", reason: "run-disappeared" });
            controller.close();
            clearInterval(interval);
            return;
          }
          const counts = {
            pending: 0,
            running: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
          };
          for (const j of jobs) {
            counts[j.status as keyof typeof counts] = j._count._all;
          }

          const snapshot = {
            status: run.status,
            producedCount: run.producedCount,
            targetCount: run.targetCount,
            acceptedCount: run.acceptedCount,
            tokensIn: Number(run.tokensIn),
            tokensOut: Number(run.tokensOut),
            costUsd: run.costUsd ? Number(run.costUsd) : 0,
            counts,
          };
          const sig = JSON.stringify(snapshot);
          if (sig !== lastSig) {
            send({ kind: "snapshot", snapshot });
            lastSig = sig;
          } else {
            // Heartbeat to keep proxies happy.
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          }

          // Auto-close on terminal status or after timeout.
          const terminal = ["completed", "failed", "cancelled"].includes(run.status);
          if (terminal || Date.now() - startedAt > ABORT_TIMEOUT_MS) {
            clearInterval(interval);
            controller.close();
          }
        } catch (e) {
          send({ kind: "error", reason: (e as Error).message });
          clearInterval(interval);
          controller.close();
        }
      }, POLL_INTERVAL_MS);

      // Abort on client disconnect.
      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
