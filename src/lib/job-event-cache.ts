// Process-wide buffer of pg_notify events on the `synthgen_job` channel.
//
// Why this exists: the SSE route used to open its own pg LISTEN per request,
// which meant a page refresh closed the connection and threw away every
// event seen so far. The new connection only saw events arriving from that
// point on, so the user lost the assistant turn / tool calls that streamed
// before the refresh.
//
// This module starts a single pg LISTEN client per Next.js process, buffers
// events per jobId, and lets SSE routes (a) replay everything cached so far
// and (b) subscribe for new events going forward. Buffers for terminal jobs
// stick around for 60 s so a fast refresh still gets the tail of the stream,
// then evict so memory doesn't grow unbounded.
//
// The state is anchored on globalThis so HMR / module-isolation in dev
// doesn't accidentally start a second LISTEN client.

import { Client } from "pg";

export interface JobEvent {
  event: string;
  jobId?: string;
  [key: string]: unknown;
}

interface CacheState {
  client: Client | null;
  starting: Promise<void> | null;
  buffers: Map<string, JobEvent[]>;
  subscribers: Map<string, Set<(e: JobEvent) => void>>;
  evictTimers: Map<string, ReturnType<typeof setTimeout>>;
}

const GLOBAL_KEY = Symbol.for("synthgen.jobEventCache.v1");

// Cap how much we buffer per job so a runaway worker can't OOM the server.
// 10 000 events is well above a normal multi-turn conversation's emission
// count; anything beyond is dropped (the live forward still works).
const PER_JOB_LIMIT = 10_000;
// Keep terminal jobs around briefly so a refresh-after-done still replays
// the conversation. Live-streaming jobs that hit `done` rely on this window
// to bridge the gap until the saved-Messages replay path takes over (which
// kicks in only once the route sees the job as terminal in Prisma).
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
      if (msg.channel !== "synthgen_job" || !msg.payload) return;
      let parsed: JobEvent;
      try {
        parsed = JSON.parse(msg.payload) as JobEvent;
      } catch {
        return;
      }
      const jobId = typeof parsed.jobId === "string" ? parsed.jobId : undefined;
      if (!jobId) return;

      const buf = s.buffers.get(jobId) ?? [];
      if (buf.length < PER_JOB_LIMIT) buf.push(parsed);
      s.buffers.set(jobId, buf);

      const subs = s.subscribers.get(jobId);
      if (subs) {
        for (const handler of subs) {
          try {
            handler(parsed);
          } catch {
            // a misbehaving subscriber must not break the bus
          }
        }
      }

      if (parsed.event === "done") {
        const existing = s.evictTimers.get(jobId);
        if (existing) clearTimeout(existing);
        s.evictTimers.set(
          jobId,
          setTimeout(() => {
            s.buffers.delete(jobId);
            s.evictTimers.delete(jobId);
          }, TERMINAL_RETENTION_MS),
        );
      }
    });
    c.on("error", () => {
      // Drop the client so the next subscriber re-initialises. We don't
      // try to reconnect in a loop because in practice the next request
      // (heartbeat, status poll) re-arms us. Any events lost between
      // disconnect and the next ensureStarted are unrecoverable.
      s.client = null;
    });
    await c.query("LISTEN synthgen_job");
    s.client = c;
  })();
  try {
    await s.starting;
  } finally {
    s.starting = null;
  }
}

// Public init — call once per request before subscribing. Idempotent.
export async function ensureJobEventCacheStarted(): Promise<void> {
  await ensureStarted();
}

// Read the buffered events for a job without registering as a subscriber.
// Used by the SSE route on the terminal-replay path: if the job streamed
// through this process while it was alive, the cache has its events even
// after it's been marked terminal — richer than the Messages-row replay,
// which only has whatever was persisted on commit.
export function peekJobEvents(jobId: string): JobEvent[] {
  const s = getState();
  return (s.buffers.get(jobId) ?? []).slice();
}

// Drop the buffer for a job. Call this BEFORE a job is re-dispatched
// (Regenerate / per-job restart) — without it, the cache replays the
// previous run's events ahead of the new run, which manifests as the old
// user turn showing up alongside the new assistant turn.
export function clearJobEvents(jobId: string): void {
  const s = getState();
  s.buffers.delete(jobId);
  const t = s.evictTimers.get(jobId);
  if (t) {
    clearTimeout(t);
    s.evictTimers.delete(jobId);
  }
}

// Subscribe to a job's event stream. Replays buffered past events to
// `onEvent` SYNCHRONOUSLY in arrival order, then registers `onEvent` for
// future events. The whole body is sync so no notification can preempt
// it — past events arrive strictly before live ones with no duplication
// or gaps.
//
// Caller must await `ensureJobEventCacheStarted()` first (kept separate so
// the subscribe path stays sync).
export function subscribeJobEvents(
  jobId: string,
  onEvent: (e: JobEvent) => void,
): () => void {
  const s = getState();
  const buf = s.buffers.get(jobId) ?? [];
  for (const e of buf) {
    onEvent(e);
  }
  let subs = s.subscribers.get(jobId);
  if (!subs) {
    subs = new Set();
    s.subscribers.set(jobId, subs);
  }
  subs.add(onEvent);
  return () => {
    const set = s.subscribers.get(jobId);
    if (!set) return;
    set.delete(onEvent);
    if (set.size === 0) s.subscribers.delete(jobId);
  };
}
