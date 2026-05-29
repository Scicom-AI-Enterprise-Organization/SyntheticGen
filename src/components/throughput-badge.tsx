"use client";

// Tiny chip that estimates the live tokens-per-second rate of any text-only
// streaming UI. Pass the accumulated text + a `startedAt` timestamp; the
// badge re-renders whenever `text` updates and ticks itself once a second
// while `running` is true so the elapsed-time readout stays current even
// during stalls.
//
// Token counts are derived from char length / 4 — the client doesn't see
// real tokenized chunks, so this is the same approximation the OpenAI and
// Anthropic dashboards use for "live throughput" estimates. Accuracy is
// usually within ±20% of the real tokenizer count.

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";

export function ThroughputBadge({
  text,
  startedAt,
  running,
  className,
}: {
  text: string;
  startedAt: number | null;
  running: boolean;
  className?: string;
}) {
  // Force a re-render every second while streaming so the rate updates
  // between deltas (otherwise stalls would show the rate frozen at its
  // last delta).
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Freeze the elapsed time at the moment `running` flips from true → false
  // (job done / cancelled / failed). Without this, every parent re-render
  // recomputed `Date.now() - startedAt` and the badge kept ticking forever
  // even after the stream stopped.
  const frozenAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (running) {
      // New stream starting (or resuming) — clear any prior freeze.
      frozenAtRef.current = null;
    } else if (startedAt) {
      // First render where running is false AND we'd already started:
      // capture "now" so future renders use this as the end time.
      if (frozenAtRef.current === null) {
        frozenAtRef.current = Date.now();
      }
    }
  }, [running, startedAt]);

  if (!startedAt || text.length === 0) return null;
  // While running, use the live clock. Once frozen, use the captured end
  // time so the chip reads the final tok/s + elapsed indefinitely.
  const now = running ? Date.now() : (frozenAtRef.current ?? Date.now());
  const elapsedMs = Math.max(1, now - startedAt);
  const tokens = text.length / 4;
  const tps = (tokens * 1000) / elapsedMs;
  const elapsedSec = elapsedMs / 1000;

  // Format gracefully — sub-1 shows 1 decimal, larger numbers don't.
  const tpsLabel =
    tps < 1 ? `${tps.toFixed(2)} tok/s` : `${tps.toFixed(1)} tok/s`;
  const timeLabel =
    elapsedSec < 60
      ? `${elapsedSec.toFixed(1)}s`
      : `${Math.floor(elapsedSec / 60)}m ${Math.round(elapsedSec % 60)}s`;

  return (
    <Badge variant="outline" className={"font-mono text-[10px] " + (className ?? "")}>
      {tpsLabel} · {timeLabel} · ~{Math.round(tokens)} tok
    </Badge>
  );
}
