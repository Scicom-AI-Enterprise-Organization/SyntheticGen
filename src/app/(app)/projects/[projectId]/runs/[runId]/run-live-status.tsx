"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  queued: "secondary",
  running: "default",
  paused: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

interface Initial {
  status: string;
  producedCount: number;
  targetCount: number;
  acceptedCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  counts: { pending: number; running: number; succeeded: number; failed: number; skipped: number };
}

export function RunLiveStatus({
  projectId,
  runId,
  initial,
}: {
  projectId: string;
  runId: string;
  initial: Initial;
}) {
  const [s, setS] = useState(initial);

  useEffect(() => {
    const url = `/api/projects/${projectId}/runs/${runId}/stream`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.kind === "snapshot") {
          setS(parsed.snapshot);
        }
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => {
      // Browser will retry automatically; nothing to do.
    };
    return () => es.close();
  }, [projectId, runId]);

  const pct = s.targetCount > 0 ? Math.round((s.producedCount / s.targetCount) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Progress</CardTitle>
          <Badge variant={STATUS_VARIANT[s.status] ?? "outline"}>{s.status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-mono">
            {s.producedCount} / {s.targetCount}
          </span>
          <span className="text-xs text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} className="h-2" />

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Stat label="Accepted" value={s.acceptedCount} />
          <Stat label="Tokens in" value={s.tokensIn.toLocaleString()} />
          <Stat label="Tokens out" value={s.tokensOut.toLocaleString()} />
          <Stat label="Cost (USD)" value={`$${s.costUsd.toFixed(4)}`} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {Object.entries(s.counts).map(([k, v]) => (
            <Badge key={k} variant="outline">
              {k}: {v}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}
