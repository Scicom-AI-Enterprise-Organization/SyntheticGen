import { NextRequest } from "next/server";
import { Client } from "pg";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// LISTEN to the shared `synthgen_job` channel and forward only deltas matching
// the requested jobId. Each token-delta the worker emits becomes one SSE event.
export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ projectId: string; runId: string; jobId: string }>;
  },
) {
  const { projectId, runId, jobId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "runs.read");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  // Make sure the job belongs to this run / project before exposing it.
  const job = await prisma.generationJob.findFirst({
    where: { id: jobId, runId, run: { projectId } },
    select: { id: true, status: true },
  });
  if (!job) {
    return new Response(
      JSON.stringify({ error: "job not found in this run" }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return new Response(
      JSON.stringify({ error: "DATABASE_URL not set" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // controller closed
        }
      };

      const client = new Client({ connectionString: databaseUrl });
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let watchdogTimer: ReturnType<typeof setInterval> | null = null;
      const startedAt = Date.now();

      const shutdown = async () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (watchdogTimer) clearInterval(watchdogTimer);
        try {
          await client.end();
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      try {
        await client.connect();
        client.on("notification", (msg) => {
          if (msg.channel !== "synthgen_job" || !msg.payload) return;
          let parsed: { jobId?: string; event?: string };
          try {
            parsed = JSON.parse(msg.payload);
          } catch {
            return;
          }
          if (parsed.jobId !== jobId) return;
          send(parsed);
          if (parsed.event === "done") {
            // Give the client one tick to receive it, then close.
            setTimeout(shutdown, 50);
          }
        });
        client.on("error", (e) => {
          send({ event: "error", error: e.message });
          shutdown();
        });
        await client.query("LISTEN synthgen_job");

        send({ event: "open", jobId });

        // If the job already finished before we connected, emit done immediately.
        const latest = await prisma.generationJob.findUnique({
          where: { id: jobId },
          select: { status: true },
        });
        if (latest && ["succeeded", "failed", "skipped"].includes(latest.status)) {
          send({ event: "done", status: latest.status });
          shutdown();
          return;
        }

        // SSE-level heartbeats so intermediaries don't drop the conn.
        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            // ignore
          }
        }, 15_000);

        // Watchdog: close after 10 minutes max.
        watchdogTimer = setInterval(() => {
          if (Date.now() - startedAt > 10 * 60 * 1000) shutdown();
        }, 30_000);

        req.signal.addEventListener("abort", () => {
          shutdown();
        });
      } catch (e) {
        send({ event: "error", error: (e as Error).message });
        await shutdown();
      }
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
