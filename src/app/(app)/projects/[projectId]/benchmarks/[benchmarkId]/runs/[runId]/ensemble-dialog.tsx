"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, RefreshCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ensembleRejudge } from "../../../actions";

interface JudgeSummary {
  providerCredentialId: string;
  providerName: string;
  providerKind: string;
  model: string;
}

const NONE = "__none__";

// Dispatch a Tier-3 ensemble re-judge over a subset of a completed
// benchmark run. Judges themselves are configured ONCE at the project
// level (Benchmarks page → Ensemble judges card); this dialog just
// shows the list read-only and asks the user for the row filter +
// disagreement threshold. When fewer than 2 judges are saved, the
// trigger button is disabled with a tooltip pointing at the project
// page.
export function EnsembleDialog({
  projectId,
  runId,
  judges,
}: {
  projectId: string;
  runId: string;
  judges: JudgeSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [verdictFilter, setVerdictFilter] = useState<string>(NONE);
  const [topPercent, setTopPercent] = useState(10); // top 10%
  const [minAxisScore, setMinAxisScore] = useState(3);
  const [threshold, setThreshold] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const configured = judges.length >= 2;
  const missingTooltip = configured
    ? undefined
    : judges.length === 0
      ? "No ensemble judges configured. Open Benchmarks → Ensemble judges to set them up."
      : "Only one judge configured. Add another in Benchmarks → Ensemble judges to enable.";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    start(async () => {
      const filter: Record<string, unknown> = {};
      if (verdictFilter !== NONE) filter.verdict = verdictFilter;
      if (topPercent > 0 && topPercent < 100) filter.topPercent = topPercent / 100;
      if (minAxisScore > 1) filter.minAxisScore = minAxisScore;

      const res = await ensembleRejudge({
        projectId,
        runId,
        filter,
        threshold,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setInfo("Ensemble dispatched. Refresh the page in a minute to see per-row consensus.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!configured}
          title={missingTooltip}
        >
          <Layers className="mr-2 h-3.5 w-3.5" />
          Re-judge with ensemble
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Multi-judge ensemble re-judge</DialogTitle>
          <DialogDescription>
            Tier-3 pass: re-judge a subset of this run with the project&apos;s
            configured ensemble judges. Each row gets per-judge breakdowns, a
            median per-axis score, and a disagreement metric.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          {/* Read-only view of the project's saved judges. The user
              configures them once on the project benchmarks page; here
              we just confirm what's about to run. */}
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px]">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-muted-foreground">
                Using {judges.length} judge{judges.length === 1 ? "" : "s"} from project settings
              </span>
              <Link
                href={`/projects/${projectId}/benchmarks`}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
              >
                <Settings className="h-3 w-3" />
                Configure
              </Link>
            </div>
            <ul className="space-y-0.5 font-mono">
              {judges.map((j, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {j.providerKind}
                  </Badge>
                  <span>{j.model}</span>
                  <span className="text-muted-foreground">via {j.providerName}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ens-verdict">Verdict filter</Label>
              <Select value={verdictFilter} onValueChange={setVerdictFilter}>
                <SelectTrigger id="ens-verdict">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Any verdict</SelectItem>
                  <SelectItem value="pass">pass only</SelectItem>
                  <SelectItem value="warn">warn only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ens-pct">Top percent</Label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {topPercent}%
                </span>
              </div>
              <Slider
                id="ens-pct"
                min={1}
                max={100}
                step={1}
                value={[topPercent]}
                onValueChange={([v]) => setTopPercent(v)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ens-floor">Min per-axis score</Label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  ≥ {minAxisScore}
                </span>
              </div>
              <Slider
                id="ens-floor"
                min={1}
                max={5}
                step={1}
                value={[minAxisScore]}
                onValueChange={([v]) => setMinAxisScore(v)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ens-thresh">Disagreement threshold</Label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {threshold.toFixed(2)}
                </span>
              </div>
              <Slider
                id="ens-thresh"
                min={0}
                max={3}
                step={0.1}
                value={[threshold]}
                onValueChange={([v]) => setThreshold(v)}
              />
              <p className="text-[10px] text-muted-foreground">
                Max per-axis spread allowed. Rows above this get flagged.
              </p>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300">
              {info}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? (
                <>
                  <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Dispatching…
                </>
              ) : (
                <>
                  <Layers className="mr-2 h-3.5 w-3.5" />
                  Start ensemble
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
