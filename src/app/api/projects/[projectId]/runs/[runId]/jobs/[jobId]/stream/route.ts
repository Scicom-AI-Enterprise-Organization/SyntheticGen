import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import {
  ensureJobEventCacheStarted,
  peekJobEvents,
  subscribeJobEvents,
} from "@/lib/job-event-cache";

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
  if (!process.env.DATABASE_URL) {
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

      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let watchdogTimer: ReturnType<typeof setInterval> | null = null;
      let statusPollTimer: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      const startedAt = Date.now();

      const shutdown = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (watchdogTimer) clearInterval(watchdogTimer);
        if (statusPollTimer) clearInterval(statusPollTimer);
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // ignore
          }
          unsubscribe = null;
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Shared helper: replay flow.graph + flow.step from JobEvent so the
      // run-page visualization paints "green" past nodes whether the job
      // is still running or already terminal. The in-process pg_notify
      // cache only buffers events that fired AFTER the cache started
      // listening; if the user opens a job that's already mid-flight,
      // earlier flow.node.start events aren't in the buffer. Pulling from
      // JobEvent here covers that gap regardless of cache state.
      //
      // IMPORTANT: restartable jobs accumulate MULTIPLE flow.loaded +
      // flow.step rows (one set per attempt). We only want the CURRENT
      // attempt's events, so we anchor on the latest flow.loaded and
      // filter steps by ts >= that anchor. Without this, the UI replays
      // stale nodes from prior runs and "visited" sticks on nodes that
      // aren't actually part of the current attempt's path.
      const replayFlowFromJobEvents = async () => {
        const flowLoaded = await prisma.jobEvent.findFirst({
          where: { jobId, kind: "flow.loaded" },
          orderBy: { ts: "desc" },
          select: { payload: true, ts: true },
        });
        const unwrapPayload = (v: unknown): unknown => {
          if (typeof v !== "string") return v;
          try {
            return JSON.parse(v);
          } catch {
            return v;
          }
        };
        const flowLoadedPayload = unwrapPayload(flowLoaded?.payload);
        if (
          !flowLoadedPayload ||
          typeof flowLoadedPayload !== "object" ||
          Array.isArray(flowLoadedPayload)
        ) {
          return;
        }
        const p = flowLoadedPayload as Record<string, unknown>;
        const graph = (p.graph as Record<string, unknown> | undefined) ?? null;
        if (graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)) {
          send({
            event: "flow.graph",
            flowId: typeof p.flowId === "string" ? p.flowId : "",
            name: typeof p.name === "string" ? p.name : null,
            nodes: graph.nodes,
            edges: graph.edges,
          });
        }
        const steps = await prisma.jobEvent.findMany({
          where: {
            jobId,
            kind: "flow.step",
            // Only the current attempt's steps. flowLoaded.ts is non-null
            // when flowLoaded exists (we just queried it above).
            ts: { gte: flowLoaded?.ts ?? new Date(0) },
          },
          orderBy: { ts: "asc" },
          select: { payload: true },
        });
        for (const ev of steps) {
          const sp = unwrapPayload(ev.payload);
          if (!sp || typeof sp !== "object" || Array.isArray(sp)) continue;
          const s = sp as Record<string, unknown>;
          const node = typeof s.node === "string" ? s.node : "";
          const kind = typeof s.kind === "string" ? s.kind : "";
          const label = typeof s.label === "string" ? s.label : null;
          send({ event: "flow.node.start", node, kind, label });
          send({
            event: "flow.step",
            node,
            kind,
            label,
            userText: typeof s.userText === "string" ? s.userText : "",
            chosenLabel: typeof s.chosenLabel === "string" ? s.chosenLabel : null,
            options: Array.isArray(s.options) ? s.options : [],
            outcome: typeof s.outcome === "string" ? s.outcome : null,
            finalContentChars:
              typeof s.finalContentChars === "number" ? s.finalContentChars : null,
          });
        }
      };

      try {
        send({ event: "open", jobId });

        // Start the cache eagerly so terminal-job replay below can peek at
        // any events buffered while this job was still running (cancelled
        // jobs in particular often produced events but didn't persist
        // Messages — the cache is the only place those events survive).
        await ensureJobEventCacheStarted();

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
          // PREFER cache replay over Messages replay for terminal jobs that
          // streamed through this process. The cache captured the raw
          // pg_notify events (deltas, turn markers, tool fragments) which
          // give a richer playback than what got persisted as Messages.
          // Cancelled jobs in particular often have no saved Messages at
          // all — without the cache, the UI just shows "Waiting for the
          // first event…" forever.
          const cached = peekJobEvents(jobId);
          if (cached.length > 0) {
            for (const ev of cached) {
              if (ev.event === "done") continue; // we emit our own done below
              send(ev);
            }
            send({
              event: "done",
              status: latest.status,
              reason: "cache-replay",
              tokens_in: Number(latest.tokensIn ?? 0),
              tokens_out: Number(latest.tokensOut ?? 0),
              latency_ms: latest.latencyMs ?? 0,
              lastError: latest.lastError ?? null,
            });
            shutdown();
            return;
          }
          await replayFlowFromJobEvents();

          // Pull every "user.simulator.request" + "user.simulator.response"
          // JobEvent so we can replay the simulator-prompt cards BEFORE the
          // user turns they produced AND fill in the streamed reasoning +
          // output that landed inside each card. Keyed by purpose
          // (`user_turn_1_*` / `user_turn_N`) so the message-replay loop
          // below can pop the matching one as each user turn comes up.
          const simEvents = await prisma.jobEvent.findMany({
            where: {
              jobId,
              kind: { in: ["user.simulator.request", "user.simulator.response"] },
            },
            orderBy: { ts: "asc" },
            select: { kind: true, payload: true },
          });
          const simReqByTurn = new Map<number, Record<string, unknown>>();
          const simRespByTurn = new Map<number, Record<string, unknown>>();
          // Some historical JobEvent.payload rows are double-encoded JSON
          // strings (asyncpg jsonb codec + a `json.dumps()` upstream both
          // ran). Unwrap on read so old rows replay correctly.
          const unwrap = (v: unknown): unknown => {
            if (typeof v !== "string") return v;
            try {
              return JSON.parse(v);
            } catch {
              return v;
            }
          };
          for (const ev of simEvents) {
            const raw = unwrap(ev.payload);
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
            const p = raw as Record<string, unknown>;
            const purpose = typeof p.purpose === "string" ? p.purpose : "";
            // user_turn_1_tool_aware / user_turn_1_seed → turn 1.
            // user_turn_<N> for follow-ups.
            const m = purpose.match(/^user_turn_(\d+)/);
            if (!m) continue;
            const turn = Number(m[1]);
            if (ev.kind === "user.simulator.request") simReqByTurn.set(turn, p);
            else simRespByTurn.set(turn, p);
          }
          const emitSimRequest = (turn: number) => {
            const p = simReqByTurn.get(turn);
            if (!p) return;
            const system = typeof p.system === "string" ? p.system : "";
            const SSE_MAX = 5500;
            const truncated = system.length > SSE_MAX;
            const purpose = typeof p.purpose === "string" ? p.purpose : "";
            send({
              event: "simulator.request",
              purpose,
              model: typeof p.model === "string" ? p.model : "",
              temperature: typeof p.temperature === "number" ? p.temperature : null,
              max_tokens: typeof p.max_tokens === "number" ? p.max_tokens : null,
              system: truncated ? system.slice(0, SSE_MAX) : system,
              user_msg: typeof p.user === "string" ? p.user : "",
              system_chars: system.length,
              truncated,
            });
            // Synthesize the streamed response as a single reasoning chunk
            // + single content chunk. The live preview's appendSimulatorDelta
            // reducer doesn't care whether the text arrived in one chunk or
            // 1000 — same final state either way.
            const resp = simRespByTurn.get(turn);
            if (!resp) return;
            const reasoning =
              typeof resp.reasoning_content === "string" ? resp.reasoning_content : "";
            const content = typeof resp.content === "string" ? resp.content : "";
            if (reasoning) {
              send({ event: "simulator.delta", purpose, reasoning: true, text: reasoning });
            }
            if (content) {
              send({ event: "simulator.delta", purpose, reasoning: false, text: content });
            }
          };

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
                // Replay the user-simulator request card (if we captured one
                // for this turn) immediately BEFORE the user turn it produced.
                emitSimRequest(userTurnNum);
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

        // Replay the flow graph + already-fired flow.step events from
        // JobEvent BEFORE subscribing to live deltas. The in-process
        // pg_notify cache is started lazily on first subscriber, so for
        // jobs that started before this Next.js process did (dev-server
        // restart, page opened mid-flight), the cache has no buffered
        // flow.node.start events to replay. Without this, the run-page
        // visualization opens with every past node marked "unvisited"
        // (transparent) instead of green/done — the user only ever sees
        // the currently-active node highlighted.
        await replayFlowFromJobEvents();

        // Subscribe via the process-wide cache (already started above).
        // `subscribeJobEvents` replays buffered cache events to the
        // handler SYNCHRONOUSLY before registering for future ones, so
        // live and historical events arrive in strict order with no
        // interleaving. The flow replay above + cache replay here are
        // complementary: JobEvent replay guarantees the graph + visited
        // nodes; the cache replay catches any delta/tool events the
        // cache buffered for this job.
        unsubscribe = subscribeJobEvents(jobId, (parsed) => {
          send(parsed);
          if (parsed.event === "done") {
            // Give the client one tick to receive it, then close.
            setTimeout(shutdown, 50);
          }
        });

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
        shutdown();
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
