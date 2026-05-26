"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
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
interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  judges: JudgeSummary[];
}

const VERDICT_ANY = "__any__";

// Pick an EnsembleJudgeGroup, then dispatch a Tier-3 ensemble re-judge
// over a subset of a completed run. Groups themselves are managed once
// at the project level (Benchmarks page → Ensemble judge groups);
// here the user just picks which group + filter + threshold to use.
//
// The trigger button is disabled when the project has no group with at
// least 2 judges, with a tooltip pointing at the Benchmarks page.
export function EnsembleDialog({
  projectId,
  runId,
  groups,
  defaultGroupId,
}: {
  projectId: string;
  runId: string;
  groups: GroupSummary[];
  defaultGroupId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // Pre-select the benchmark's default group; fall back to the first
  // viable group (≥2 judges) if there's no default; otherwise leave
  // unset (the button is disabled in that case).
  const usableGroups = useMemo(
    () => groups.filter((g) => g.judges.length >= 2),
    [groups],
  );
  const [groupId, setGroupId] = useState<string>(() => {
    if (defaultGroupId && usableGroups.find((g) => g.id === defaultGroupId)) {
      return defaultGroupId;
    }
    return usableGroups[0]?.id ?? "";
  });
  const [verdictFilter, setVerdictFilter] = useState<string>(VERDICT_ANY);
  const [topPercent, setTopPercent] = useState(10);
  const [minAxisScore, setMinAxisScore] = useState(3);
  const [threshold, setThreshold] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === groupId) ?? null,
    [groups, groupId],
  );

  const configured = usableGroups.length > 0;
  const tooltip = configured
    ? undefined
    : groups.length === 0
      ? "No ensemble groups configured. Open Benchmarks → Ensemble judge groups to create one."
      : "All configured groups have fewer than 2 judges. Add more judges in Benchmarks → Ensemble judge groups.";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!groupId) {
      setError("Pick a group with at least 2 judges.");
      return;
    }
    start(async () => {
      const filter: Record<string, unknown> = {};
      if (verdictFilter !== VERDICT_ANY) filter.verdict = verdictFilter;
      if (topPercent > 0 && topPercent < 100) filter.topPercent = topPercent / 100;
      if (minAxisScore > 1) filter.minAxisScore = minAxisScore;

      const res = await ensembleRejudge({
        projectId,
        runId,
        groupId,
        filter,
        threshold,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      const name = "groupName" in res ? res.groupName : selectedGroup?.name;
      setInfo(
        `Ensemble dispatched with "${name ?? "group"}". Refresh in a minute to see per-row consensus.`,
      );
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
          title={tooltip}
        >
          <Layers className="mr-2 h-3.5 w-3.5" />
          Re-judge with ensemble
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Multi-judge ensemble re-judge</DialogTitle>
          <DialogDescription>
            Tier-3 pass: re-judge a subset of this run with one of the
            project&apos;s ensemble judge groups. Each row gets per-judge
            breakdowns, a median per-axis score, and a disagreement metric.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          {/* Group picker */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="ens-group">Ensemble group</Label>
              <Link
                href={`/projects/${projectId}/benchmarks`}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
              >
                <Settings className="h-3 w-3" />
                Manage groups
              </Link>
            </div>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger id="ens-group">
                <SelectValue placeholder="Pick a group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => {
                  const disabled = g.judges.length < 2;
                  return (
                    <SelectItem
                      key={g.id}
                      value={g.id}
                      disabled={disabled}
                    >
                      {g.name}
                      <span className="ml-1 text-muted-foreground">
                        ({g.judges.length} judge{g.judges.length === 1 ? "" : "s"}
                        {disabled && " — needs ≥2"})
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedGroup && (
              <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-[11px]">
                {selectedGroup.description && (
                  <div className="mb-1 italic text-muted-foreground">
                    {selectedGroup.description}
                  </div>
                )}
                <ul className="space-y-0.5 font-mono">
                  {selectedGroup.judges.map((j, i) => (
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
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ens-verdict">Verdict filter</Label>
              <Select value={verdictFilter} onValueChange={setVerdictFilter}>
                <SelectTrigger id="ens-verdict">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={VERDICT_ANY}>Any verdict</SelectItem>
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
            <Button type="submit" size="sm" disabled={pending || !groupId}>
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
