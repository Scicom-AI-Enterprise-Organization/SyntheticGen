import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import {
  ensureBenchmarkEventCacheStarted,
  peekBenchmarkEvents,
  subscribeBenchmarkEvents,
} from "@/lib/benchmark-event-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// JSONB columns are sometimes stored as JSON-encoded strings on legacy
// rows. Parse defensively; return null on anything that isn't a plain
// object so the caller can fall back gracefully.
function safeParseObj(s: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(s);
    return p && typeof p === "object" && !Array.isArray(p)
      ? (p as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Server-Sent Events stream for a single BenchmarkRun. Reads from the
// process-wide synthgen_benchmark cache so a refresh mid-run replays every
// event accumulated so far, then forwards new ones as they arrive.
//
// Mirrors src/app/api/projects/[projectId]/runs/[runId]/jobs/[jobId]/stream
// route conceptually — see comments there for cache-replay vs live-forward
// ordering guarantees.
export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ projectId: string; benchmarkId: string; runId: string }>;
  },
) {
  const { projectId, benchmarkId, runId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "benchmarks.read");
  if (!perm.ok) {
    return new Response(JSON.stringify({ error: perm.reason }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  // Verify the run belongs to this benchmark + project so the URL can't be
  // used to reach a run from another tenant.
  const run = await prisma.benchmarkRun.findFirst({
    where: { id: runId, benchmarkId, benchmark: { projectId } },
    select: {
      id: true,
      status: true,
      totalTurns: true,
      completedTurns: true,
      failedTurns: true,
    },
  });
  if (!run) {
    return new Response(
      JSON.stringify({ error: "benchmark run not found in this project" }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  if (!process.env.DATABASE_URL) {
    return new Response(
      JSON.stringify({ error: "DATABASE_URL not set" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
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

      try {
        send({ event: "open", runId });
        // Emit a synthetic snapshot from the DB so the UI has progress
        // numbers immediately even before the first cached event lands.
        send({
          event: "snapshot",
          status: run.status,
          total: run.totalTurns,
          completed: run.completedTurns,
          failed: run.failedTurns,
        });

        await ensureBenchmarkEventCacheStarted();

        // Terminal-state replay: if the run is already done, replay any
        // cached events one-shot (so a quick refresh after completion
        // still shows the item-by-item playback) and close. If the
        // cache has been evicted (>60s after done), fall back to
        // synthesizing events from the persisted BenchmarkResult rows
        // so the Live Benchmark Preview pane stays useful indefinitely.
        if (["completed", "failed", "cancelled"].includes(run.status)) {
          const cached = peekBenchmarkEvents(runId);
          if (cached.length > 0) {
            for (const ev of cached) {
              if (ev.event === "run.done") continue;
              send(ev);
            }
          } else {
            // Cache empty — rebuild events from BenchmarkResult rows.
            // Conversation-level rows (kind='chat-replay') get one
            // item.start + candidate.replay + judge.delta + item.done.
            // Per-turn rows (kind='chat-replay-turn') are zipped into
            // their parent conversation row's item by rowIdx, each
            // contributing a turn-tagged candidate.replay + judge.delta.
            const results = await prisma.benchmarkResult.findMany({
              where: { runId },
              orderBy: [{ rowIdx: "asc" }, { turnNum: "asc" }],
              select: {
                rowIdx: true,
                turnNum: true,
                kind: true,
                conversationId: true,
                split: true,
                candidateMessages: true,
                judgeVerdict: true,
                judgeRationale: true,
                judgeScores: true,
              },
            });
            type ConvRow = (typeof results)[number];
            const byRow = new Map<number, ConvRow[]>();
            for (const r of results) {
              const list = byRow.get(r.rowIdx) ?? [];
              list.push(r);
              byRow.set(r.rowIdx, list);
            }
            const parseMessages = (raw: unknown): unknown[] | null => {
              if (typeof raw === "string") {
                try {
                  const p = JSON.parse(raw);
                  return Array.isArray(p) ? p : null;
                } catch {
                  return null;
                }
              }
              return Array.isArray(raw) ? raw : null;
            };
            const extractAssistantText = (msgs: unknown[] | null): string => {
              if (!msgs) return "";
              for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i] as { role?: string; content?: string } | null;
                if (m && m.role === "assistant" && typeof m.content === "string") {
                  return m.content;
                }
              }
              return "";
            };
            for (const [rowIdx, list] of byRow) {
              const head = list.find((r) => r.kind === "chat-replay") ?? list[0];
              send({
                event: "item.start",
                index: rowIdx,
                conversationId: head.conversationId,
                split: head.split ?? "unknown",
              });
              const turnRows = list
                .filter((r) => r.kind === "chat-replay-turn")
                .sort((a, b) => (a.turnNum ?? 0) - (b.turnNum ?? 0));
              if (turnRows.length > 0) {
                // Per-turn replay — emit one candidate.replay + one
                // judge.delta per turn so the UI's turn-by-turn renderer
                // works the same as during the live run.
                for (const tr of turnRows) {
                  const msgs = parseMessages(tr.candidateMessages);
                  const text = extractAssistantText(msgs);
                  if (text) {
                    send({
                      event: "candidate.replay",
                      index: rowIdx,
                      turn: tr.turnNum ?? 1,
                      text,
                    });
                  }
                  send({
                    event: "judge.start",
                    index: rowIdx,
                    turn: tr.turnNum ?? 1,
                    totalTurns: turnRows.length,
                  });
                  // Render the same JSON-shaped output the live stream
                  // produces so the UI is byte-identical to a fresh run.
                  const rebuilt = {
                    scores: typeof tr.judgeScores === "string"
                      ? safeParseObj(tr.judgeScores)
                      : (tr.judgeScores as Record<string, unknown> | null),
                    verdict: tr.judgeVerdict,
                    rationale: tr.judgeRationale ?? "",
                  };
                  send({
                    event: "judge.delta",
                    index: rowIdx,
                    turn: tr.turnNum ?? 1,
                    text: JSON.stringify(rebuilt, null, 2),
                  });
                }
              } else {
                // One-shot replay — single candidate.replay + judge.delta.
                const msgs = parseMessages(head.candidateMessages);
                const text = extractAssistantText(msgs);
                if (text) {
                  send({
                    event: "candidate.replay",
                    index: rowIdx,
                    turn: 1,
                    text,
                  });
                }
                send({ event: "judge.start", index: rowIdx });
                const rebuilt = {
                  scores: typeof head.judgeScores === "string"
                    ? safeParseObj(head.judgeScores)
                    : (head.judgeScores as Record<string, unknown> | null),
                  verdict: head.judgeVerdict,
                  rationale: head.judgeRationale ?? "",
                };
                send({
                  event: "judge.delta",
                  index: rowIdx,
                  text: JSON.stringify(rebuilt, null, 2),
                });
              }
              send({
                event: "item.done",
                index: rowIdx,
                conversationId: head.conversationId,
                verdict: head.judgeVerdict,
                split: head.split ?? "unknown",
              });
            }
          }
          send({
            event: "run.done",
            status: run.status,
            completed: run.completedTurns,
            failed: run.failedTurns,
            total: run.totalTurns,
            reason: "replay",
          });
          shutdown();
          return;
        }

        // Live path — replay any cached events synchronously, then
        // register for future ones. subscribeBenchmarkEvents handles the
        // replay+register atomically (no events lost in between).
        unsubscribe = subscribeBenchmarkEvents(runId, (parsed) => {
          send(parsed);
          if (parsed.event === "run.done") {
            setTimeout(shutdown, 50);
          }
        });

        // Heartbeat so proxies don't drop the conn.
        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            // ignore
          }
        }, 15_000);

        // Status poller: belt-and-braces fallback when the worker dies
        // before emitting run.done. Every 4s check the row; if terminal,
        // synthesise a done event so the UI doesn't hang in "running"
        // forever.
        let lastReportedStatus: string | null = null;
        statusPollTimer = setInterval(async () => {
          try {
            const r = await prisma.benchmarkRun.findUnique({
              where: { id: runId },
              select: {
                status: true,
                completedTurns: true,
                failedTurns: true,
                totalTurns: true,
                lastError: true,
              },
            });
            if (!r) return;
            if (["completed", "failed", "cancelled"].includes(r.status)) {
              send({
                event: "run.done",
                status: r.status,
                completed: r.completedTurns,
                failed: r.failedTurns,
                total: r.totalTurns,
                lastError: r.lastError ?? null,
                reason: "status-poll",
              });
              setTimeout(shutdown, 50);
            } else if (r.status !== lastReportedStatus) {
              lastReportedStatus = r.status;
              send({
                event: "snapshot",
                status: r.status,
                completed: r.completedTurns,
                failed: r.failedTurns,
                total: r.totalTurns,
              });
            }
          } catch {
            // ignore — heartbeat keeps the connection alive
          }
        }, 4_000);

        // Watchdog: close after 30 minutes max.
        watchdogTimer = setInterval(() => {
          if (Date.now() - startedAt > 30 * 60 * 1000) shutdown();
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
