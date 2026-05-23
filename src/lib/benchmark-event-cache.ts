// Process-wide buffer of pg_notify events on the `synthgen_benchmark`
// channel. Mirrors src/lib/job-event-cache.ts but for BenchmarkRun events
// (run.start / item.start / item.done / item.error / run.done).
//
// The benchmark page would otherwise be a static server render with no
// live progress — every refresh fetches the same snapshot. This cache
// lets the SSE route replay accumulated events on reconnect and forward
// future ones, so the Live Benchmark Preview UI can show items completing
// in real time.

import { Client } from "pg";

export interface BenchmarkEvent {
  event: string;
  runId?: string;
  [key: string]: unknown;
}

interface CacheState {
  client: Client | null;
  starting: Promise<void> | null;
  buffers: Map<string, BenchmarkEvent[]>;
  subscribers: Map<string, Set<(e: BenchmarkEvent) => void>>;
  evictTimers: Map<string, ReturnType<typeof setTimeout>>;
}

const GLOBAL_KEY = Symbol.for("synthgen.benchmarkEventCache.v1");

const PER_RUN_LIMIT = 10_000;
const TERMINAL_RETENTION_MS = 60_000;

function getState(): CacheState {
  const g = globalThis as unknown as Record<symbol, CacheState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      client: null,
      starting: null,
      buffers: new Map(),
      subscribers: new Map(),
      evictTimers: new Map(),
    };
  }
  return g[GLOBAL_KEY] as CacheState;
}

async function ensureStarted(): Promise<void> {
  const s = getState();
  if (s.client) return;
  if (s.starting) {
    await s.starting;
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");

  s.starting = (async () => {
    const c = new Client({ connectionString: databaseUrl });
    await c.connect();
    c.on("notification", (msg) => {
      if (msg.channel !== "synthgen_benchmark" || !msg.payload) return;
      let parsed: BenchmarkEvent;
      try {
        parsed = JSON.parse(msg.payload) as BenchmarkEvent;
      } catch {
        return;
      }
      const runId =
        typeof parsed.runId === "string" ? parsed.runId : undefined;
      if (!runId) return;

      const buf = s.buffers.get(runId) ?? [];
      if (buf.length < PER_RUN_LIMIT) buf.push(parsed);
      s.buffers.set(runId, buf);

      const subs = s.subscribers.get(runId);
      if (subs) {
        for (const handler of subs) {
          try {
            handler(parsed);
          } catch {
            // a misbehaving subscriber must not break the bus
          }
        }
      }

      // run.done is the only event that should trigger eviction; per-item
      // events keep the buffer fresh as the run progresses.
      if (parsed.event === "run.done") {
        const existing = s.evictTimers.get(runId);
        if (existing) clearTimeout(existing);
        s.evictTimers.set(
          runId,
          setTimeout(() => {
            s.buffers.delete(runId);
            s.evictTimers.delete(runId);
          }, TERMINAL_RETENTION_MS),
        );
      }
    });
    c.on("error", () => {
      s.client = null;
    });
    await c.query("LISTEN synthgen_benchmark");
    s.client = c;
  })();
  try {
    await s.starting;
  } finally {
    s.starting = null;
  }
}

export async function ensureBenchmarkEventCacheStarted(): Promise<void> {
  await ensureStarted();
}

export function peekBenchmarkEvents(runId: string): BenchmarkEvent[] {
  const s = getState();
  return (s.buffers.get(runId) ?? []).slice();
}

export function clearBenchmarkEvents(runId: string): void {
  const s = getState();
  s.buffers.delete(runId);
  const t = s.evictTimers.get(runId);
  if (t) {
    clearTimeout(t);
    s.evictTimers.delete(runId);
  }
}

// Subscribe to a benchmark run's event stream. Past events are replayed
// to the handler synchronously (in arrival order), then the handler is
// registered for future events. Same race-free pattern as
// job-event-cache.ts — pg notification callbacks cannot preempt sync JS,
// so no event can interleave with the past replay.
export function subscribeBenchmarkEvents(
  runId: string,
  onEvent: (e: BenchmarkEvent) => void,
): () => void {
  const s = getState();
  const buf = s.buffers.get(runId) ?? [];
  for (const e of buf) {
    onEvent(e);
  }
  let subs = s.subscribers.get(runId);
  if (!subs) {
    subs = new Set();
    s.subscribers.set(runId, subs);
  }
  subs.add(onEvent);
  return () => {
    const set = s.subscribers.get(runId);
    if (!set) return;
    set.delete(onEvent);
    if (set.size === 0) s.subscribers.delete(runId);
  };
}
