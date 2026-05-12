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
      let statusPollTimer: ReturnType<typeof setInterval> | null = null;
      const startedAt = Date.now();

      const shutdown = async () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (watchdogTimer) clearInterval(watchdogTimer);
        if (statusPollTimer) clearInterval(statusPollTimer);
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

        // If the job already finished, replay the saved content / reasoning
        // from its Message rows as synthetic delta events, then close. That
        // way the Live Job Preview shows the FULL output even for past jobs
        // — no need to keep streaming once it's saved.
        const latest = await prisma.generationJob.findUnique({
          where: { id: jobId },
          select: {
            status: true,
            conversationId: true,
            tokensIn: true,
            tokensOut: true,
            latencyMs: true,
            lastError: true,
          },
        });
        if (latest && ["succeeded", "failed", "skipped", "cancelled"].includes(latest.status)) {
          // Pull all assistant messages from the conversation (single-turn jobs
          // produce one; multi-turn jobs produce N). We replay reasoning first
          // then content for each, with [turn N] headers so the UI shows the
          // same flow it would have during live streaming.
          if (latest.conversationId) {
            const msgs = await prisma.message.findMany({
              where: { conversationId: latest.conversationId },
              orderBy: { ordinal: "asc" },
              select: {
                role: true,
                content: true,
                reasoningContent: true,
                toolCalls: true,
                toolCallId: true,
              },
            });

            // Emit the SAME structured events the live worker emits so the UI
            // renders identical blocks (user_turn, assistant_turn, tool_call,
            // tool_result, …) instead of raw "[user · turn N]" text markers.
            //
            // IMPORTANT: assistant turns are numbered by USER turn, not by the
            // raw assistant-message ordinal. A single user turn may produce
            // multiple assistant rows (tool_call → tool_result → follow-up
            // content). The FIRST assistant after a user becomes the labeled
            // `turn.assistant`; subsequent assistant messages until the next
            // user are emitted as `turn.followup` so the count stays aligned.
            let userTurnNum = 0;
            let toolCallIdx = 0;
            // Tracks whether we've already emitted `turn.assistant` for the
            // current user turn. The next assistant message in the same turn
            // becomes a `turn.followup`.
            let assistantOpened = false;
            for (const m of msgs) {
              // Skip the system prompt — huge KB block, not part of the
              // streamed UX, and the live worker doesn't emit one either.
              if (m.role === "system") continue;

              if (m.role === "user") {
                userTurnNum += 1;
                assistantOpened = false;
                send({
                  event: "turn.user",
                  turn: userTurnNum,
                  text: m.content ?? "",
                });
                continue;
              }

              if (m.role === "tool") {
                const preview = (m.content ?? "").replace(/\s+/g, " ");
                const trimmed = preview.length > 200 ? preview.slice(0, 200) + "…" : preview;
                send({
                  event: "tool.result",
                  name: "", // worker doesn't always store the tool name on the
                            //  message row; the UI handles empty gracefully.
                  preview: trimmed,
                });
                continue;
              }

              if (m.role !== "assistant") continue;
              if (!assistantOpened) {
                send({ event: "turn.assistant", turn: userTurnNum });
                assistantOpened = true;
              } else {
                send({ event: "turn.followup" });
              }

              if (m.reasoningContent) {
                send({ event: "delta", text: m.reasoningContent, reasoning: true });
              }
              if (m.content) {
                send({ event: "delta", text: m.content, reasoning: false });
              }

              // Tool calls — replay each as a fragment + complete pair so
              // the UI's `upsertToolCall` + `completeToolCall` reducers see
              // the same shape they do during live streaming. Arguments come
              // as one chunk (we don't have token-level fragments saved).
              const tc = m.toolCalls as unknown;
              const parsed = Array.isArray(tc)
                ? (tc as Array<{ function?: { name?: string; arguments?: string } }>)
                : typeof tc === "string"
                  ? (() => {
                      try {
                        const p = JSON.parse(tc);
                        return Array.isArray(p) ? p : [];
                      } catch {
                        return [];
                      }
                    })()
                  : [];
              for (const call of parsed) {
                const idx = toolCallIdx++;
                const name = call.function?.name ?? "?";
                const args = call.function?.arguments ?? "{}";
                send({ event: "tool.call.frag", index: idx, name, fragment: args });
                send({ event: "tool.call.complete", index: idx });
              }
            }
          }
          send({
            event: "done",
            status: latest.status,
            reason: "replay",
            tokens_in: Number(latest.tokensIn ?? 0),
            tokens_out: Number(latest.tokensOut ?? 0),
            latency_ms: latest.latencyMs ?? 0,
            lastError: latest.lastError ?? null,
          });
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

        // Status poller: belt-and-braces fallback for when the worker fails
        // to emit a `done` pg_notify (container crashed mid-job, db connection
        // hiccup, etc). Every 4s we re-check the job row; if it hit a terminal
        // state we synthesize a done event so the UI doesn't hang on
        // "Waiting for the first delta…" forever. We also tell the client when
        // the job is still queued so they can see it hasn't started yet.
        let lastReportedStatus: string | null = null;
        statusPollTimer = setInterval(async () => {
          try {
            const j = await prisma.generationJob.findUnique({
              where: { id: jobId },
              select: { status: true, lastError: true },
            });
            if (!j) return;
            if (
              ["succeeded", "failed", "skipped", "cancelled"].includes(j.status)
            ) {
              send({
                event: "done",
                status: j.status,
                reason: "status-poll",
                lastError: j.lastError ?? null,
              });
              setTimeout(shutdown, 50);
            } else if (j.status !== lastReportedStatus) {
              lastReportedStatus = j.status;
              send({ event: "status", status: j.status });
            }
          } catch {
            // ignore — the heartbeat keeps the connection alive
          }
        }, 4_000);

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
