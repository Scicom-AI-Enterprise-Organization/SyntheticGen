// Per-job event bus for streaming agent tokens during a bootstrap run.
//
// Tokens generated during an AI-assist call are ephemeral — we don't want to
// persist every chunk to the BootstrapJob.events JSON column (would balloon
// the row and force a write per token). Instead, the orchestrator emits
// tokens to an EventEmitter keyed by jobId. The SSE endpoint subscribes
// while a stream is open and forwards events to the client.
//
// The registry is anchored to `globalThis` because Next.js route groups can
// load the same module twice in dev (different sub-bundles for the (app)
// group vs the /api group). Without the global anchor, the orchestrator and
// the SSE handler would each get their own private Map and tokens would be
// emitted into the void on one side.
//
// Assumes Next.js with `runtime = "nodejs"` (single-process). For a
// multi-process / multi-replica deploy, swap the EventEmitter for Redis
// pub/sub.

import { EventEmitter } from "node:events";

export interface TokenEvent {
  step: string;
  phaseIndex: number;
  // "delta" — incremental token chunk; the client appends to a live buffer.
  // "phase-start" — orchestrator opened a new AI call within the current step.
  // "phase-end" — orchestrator closed the current AI call (success or fail).
  kind: "delta" | "phase-start" | "phase-end";
  content?: string;
  // Optional payload for phase-start/phase-end (e.g. hint, error).
  meta?: Record<string, unknown>;
}

const REGISTRY_KEY = Symbol.for("syntheticgen.bootstrap.token-bus.registry");

interface GlobalSlot {
  [REGISTRY_KEY]?: Map<string, EventEmitter>;
}

function registry(): Map<string, EventEmitter> {
  const slot = globalThis as unknown as GlobalSlot;
  if (!slot[REGISTRY_KEY]) {
    slot[REGISTRY_KEY] = new Map();
  }
  return slot[REGISTRY_KEY]!;
}

// Toggle with BOOTSTRAP_BUS_DEBUG=1 to see emit/listen tracing in the server
// log. Useful when the live agent panel stays empty and you need to confirm
// whether tokens are being emitted, listened to, or just dropped.
const DEBUG = process.env.BOOTSTRAP_BUS_DEBUG === "1";

export function getBus(jobId: string): EventEmitter {
  const buses = registry();
  let bus = buses.get(jobId);
  if (!bus) {
    bus = new EventEmitter();
    // Allow many SSE listeners + the orchestrator emitter without warnings.
    bus.setMaxListeners(50);
    if (DEBUG) {
      bus.on("newListener", (ev: string) => {
        // eslint-disable-next-line no-console
        console.log(
          `[bootstrap-bus] +listener job=${jobId} event=${ev} listeners=${bus!.listenerCount(ev) + 1}`,
        );
      });
      bus.on("removeListener", (ev: string) => {
        // eslint-disable-next-line no-console
        console.log(
          `[bootstrap-bus] -listener job=${jobId} event=${ev} listeners=${bus!.listenerCount(ev) - 1}`,
        );
      });
    }
    buses.set(jobId, bus);
  }
  return bus;
}

export function releaseBus(jobId: string): void {
  const buses = registry();
  const bus = buses.get(jobId);
  if (bus) bus.removeAllListeners();
  buses.delete(jobId);
}
