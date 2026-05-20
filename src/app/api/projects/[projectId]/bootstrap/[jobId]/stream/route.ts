// SSE stream for a bootstrap BootstrapJob. Replays the events array from
// `?since=<idx>` (default 0) then polls the row every ~600ms for new events,
// emitting them as SSE `data:` lines. Closes when the job reaches a terminal
// status (completed | failed | cancelled) and the client has caught up.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { getBus, type TokenEvent } from "@/lib/bootstrap-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BootstrapEvent {
  idx: number;
  ts: string;
  step: string;
  kind: string;
  payload?: Record<string, unknown>;
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; jobId: string }> },
) {
  const { projectId, jobId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "project.read");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  // Defence in depth — confirm the job belongs to the project.
  const job = await prisma.bootstrapJob.findFirst({
    where: { id: jobId, projectId },
    select: { id: true },
  });
  if (!job) {
    return new Response(JSON.stringify({ error: "job not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const sinceParam = new URL(req.url).searchParams.get("since") ?? "0";
  const initialSince = Math.max(0, Number.parseInt(sinceParam, 10) || 0);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let since = initialSince;
      let closed = false;
      const closeIt = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", closeIt);

      // Heartbeat keeps proxies from timing out idle connections.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closeIt();
        }
      }, 15_000);

      function send(eventName: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          closeIt();
        }
      }

      // Subscribe to the in-memory token bus for live streaming deltas. The
      // bus is only populated while the orchestrator process is actively
      // generating, so reconnecting clients get persisted events from the DB
      // (above) and live tokens (here) seamlessly.
      const bus = getBus(jobId);
      if (process.env.BOOTSTRAP_BUS_DEBUG === "1") {
        // eslint-disable-next-line no-console
        console.log(
          `[bootstrap-sse] subscribe job=${jobId} bus-listeners-before=${bus.listenerCount("token")}`,
        );
      }
      const onToken = (evt: TokenEvent) => send("token", evt);
      bus.on("token", onToken);
      req.signal.addEventListener("abort", () => {
        bus.off("token", onToken);
      });

      try {
        while (!closed) {
          const row = await prisma.bootstrapJob.findUnique({
            where: { id: jobId },
            select: {
              status: true,
              currentStep: true,
              events: true,
              inserted: true,
              error: true,
              startedAt: true,
              completedAt: true,
            },
          });
          if (!row) {
            send("error", { error: "job vanished" });
            break;
          }

          const events = (row.events as unknown as BootstrapEvent[]) ?? [];
          const newOnes = events.slice(since);
          for (const evt of newOnes) {
            send("event", evt);
          }
          since = events.length;

          // Always emit a status snapshot at the end of each tick so the UI's
          // checklist + counts can re-sync without parsing every event.
          send("status", {
            status: row.status,
            currentStep: row.currentStep,
            inserted: row.inserted ?? {},
            error: row.error,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            eventCount: events.length,
          });

          if (isTerminal(row.status)) {
            send("close", { reason: row.status });
            break;
          }

          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 600);
            req.signal.addEventListener("abort", () => {
              clearTimeout(t);
              resolve();
            });
          });
        }
      } finally {
        clearInterval(heartbeat);
        bus.off("token", onToken);
        closeIt();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
