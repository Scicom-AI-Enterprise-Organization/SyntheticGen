"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { startBenchmarkRun } from "../actions";

interface ProviderOption {
  id: string;
  name: string;
  kind: string;
  defaultModel: string | null;
}
interface RubricOption {
  id: string;
  name: string;
  isPreset: boolean;
}
interface JudgeRef {
  providerCredentialId: string;
  providerName: string;
  providerKind: string;
  model: string;
}
interface EnsembleGroupOption {
  id: string;
  name: string;
  description: string | null;
  judges: JudgeRef[];
}

const NONE = "__none__";

// Chat-replay runs are scored by an EnsembleJudgeGroup. A group of 1
// judge behaves identically to the old "single judge" form — same code
// path, no special-casing. Groups of 2+ judges produce per-row
// consensus (median per-axis scores, worst verdict, max disagreement).
//
// Groups themselves are managed once at the project level (Benchmarks
// page → Ensemble judge groups). Here the user just picks which group
// + consensus method + rubric + sampling.
export function StartRunForm({
  projectId,
  benchmarkId,
  benchmarkKind,
  defaultMode,
  defaultRubricId,
  defaultEnsembleGroupId,
  rubrics,
  ensembleGroups,
}: {
  projectId: string;
  benchmarkId: string;
  benchmarkKind: string;
  defaultMode?: "single-turn" | "multi-turn" | null;
  defaultRubricId?: string | null;
  defaultEnsembleGroupId?: string | null;
  // Kept in the prop bag for hf-function-call benchmarks (which still
  // need a candidate provider) but unused for chat-replay.
  providers: ProviderOption[];
  rubrics: RubricOption[];
  ensembleGroups: EnsembleGroupOption[];
}) {
  const router = useRouter();
  const isChatReplay = benchmarkKind === "project-chat-replay";

  const usableGroups = useMemo(
    () => ensembleGroups.filter((g) => g.judges.length >= 1),
    [ensembleGroups],
  );

  // Pre-select the benchmark default if any, else the first viable group.
  const [groupId, setGroupId] = useState<string>(() => {
    if (defaultEnsembleGroupId && usableGroups.find((g) => g.id === defaultEnsembleGroupId)) {
      return defaultEnsembleGroupId;
    }
    return usableGroups[0]?.id ?? "";
  });
  const selectedGroup = useMemo(
    () => ensembleGroups.find((g) => g.id === groupId) ?? null,
    [ensembleGroups, groupId],
  );
  const isMultiJudge = (selectedGroup?.judges.length ?? 0) >= 2;

  const [consensusMethod, setConsensusMethod] = useState<"median" | "mean" | "min">("median");
  const [rubricId, setRubricId] = useState<string>(defaultRubricId ?? NONE);
  const [mode, setMode] = useState<"single-turn" | "multi-turn">(defaultMode ?? "multi-turn");
  // Judge sampling — lower temperature gives more deterministic verdicts;
  // 4k tokens is enough for verdict + rationale on most rubrics.
  const [judgeTemperature, setJudgeTemperature] = useState(0.2);
  const [judgeMaxTokens, setJudgeMaxTokens] = useState(4096);
  const [judgeStrategy, setJudgeStrategy] = useState<"one-shot" | "per-turn">("per-turn");
  const [judgeMaxRetries, setJudgeMaxRetries] = useState(3);
  const [concurrency, setConcurrency] = useState(4);

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const configured = usableGroups.length > 0;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isChatReplay) {
      if (!groupId) {
        setError("Pick an ensemble judge group");
        return;
      }
      if (!selectedGroup || selectedGroup.judges.length === 0) {
        setError("Picked group has no judges configured");
        return;
      }
      const effectiveRubric = rubricId === NONE ? null : rubricId;
      if (!effectiveRubric && !defaultRubricId) {
        setError("Pick a rubric — this benchmark has no default");
        return;
      }
    }

    start(async () => {
      // BenchmarkRun's candidate columns are required by the schema, so
      // we reuse the group's first judge as a placeholder — the worker
      // doesn't re-invoke any candidate for chat-replay.
      const firstJudge = selectedGroup?.judges[0];
      const res = await startBenchmarkRun({
        projectId,
        benchmarkId,
        providerCredentialId: firstJudge?.providerCredentialId ?? "",
        model: firstJudge?.model ?? "",
        ...(isChatReplay
          ? {
              ensembleGroupId: groupId,
              consensusMethod,
              rubricId: rubricId === NONE ? null : rubricId,
              mode,
              samplingParams: {
                judge_temperature: judgeTemperature,
                judge_max_tokens: judgeMaxTokens,
                judge_strategy: judgeStrategy,
                judge_max_retries: judgeMaxRetries,
                concurrency,
              },
            }
          : {}),
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {isChatReplay && (
        <>
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            This benchmark scores the <strong>existing reference assistant
            turns</strong> in each frozen conversation against the rubric — no
            candidate model is re-invoked. Pick an ensemble judge group
            below: a group of 1 judge runs single-judge; ≥2 judges runs
            consensus (median per-axis, worst verdict, max disagreement).
          </p>

          {!configured ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              No ensemble judge groups configured for this project. Create
              one on the{" "}
              <Link
                href={`/projects/${projectId}/benchmarks`}
                className="font-medium underline hover:text-foreground"
              >
                Benchmarks page
              </Link>{" "}
              under <em>Ensemble judge groups</em> first.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="b-group">Judge group</Label>
                  <Link
                    href={`/projects/${projectId}/benchmarks`}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    <Settings className="h-3 w-3" />
                    Manage groups
                  </Link>
                </div>
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger id="b-group">
                    <SelectValue placeholder="Pick a group" />
                  </SelectTrigger>
                  <SelectContent>
                    {ensembleGroups.map((g) => (
                      <SelectItem
                        key={g.id}
                        value={g.id}
                        disabled={g.judges.length === 0}
                      >
                        {g.name}
                        <span className="ml-1 text-muted-foreground">
                          ({g.judges.length} judge{g.judges.length === 1 ? "" : "s"}
                          {g.judges.length === 0 && " — empty"})
                        </span>
                      </SelectItem>
                    ))}
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
                          <span className="text-muted-foreground">
                            via {j.providerName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {isMultiJudge && (
                  <div className="space-y-2">
                    <Label htmlFor="b-consensus">Consensus method</Label>
                    <Select
                      value={consensusMethod}
                      onValueChange={(v) =>
                        setConsensusMethod(v as typeof consensusMethod)
                      }
                    >
                      <SelectTrigger id="b-consensus">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="median">
                          Median — robust to one outlier judge (recommended)
                        </SelectItem>
                        <SelectItem value="mean">
                          Mean — average of all judges' scores
                        </SelectItem>
                        <SelectItem value="min">
                          Min — strictest judge wins per axis
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">
                      How to aggregate the {selectedGroup?.judges.length} judges'
                      per-axis scores. Overall verdict is always the worst
                      verdict any judge returned.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="b-rubric">Rubric</Label>
                  <Select value={rubricId} onValueChange={setRubricId}>
                    <SelectTrigger id="b-rubric">
                      <SelectValue placeholder="Use benchmark default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>
                        {defaultRubricId ? "Use benchmark default" : "— no default —"}
                      </SelectItem>
                      {rubrics.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                          {r.isPreset && " (preset)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="b-mode">Replay mode</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                    <SelectTrigger id="b-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single-turn">
                        Single-turn (score first user/assistant exchange only)
                      </SelectItem>
                      <SelectItem value="multi-turn">
                        Multi-turn (score every recorded user/assistant exchange)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="b-jstrategy">Judge strategy</Label>
                  <Select
                    value={judgeStrategy}
                    onValueChange={(v) => setJudgeStrategy(v as typeof judgeStrategy)}
                  >
                    <SelectTrigger id="b-jstrategy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one-shot">
                        One-shot — single judge call per conversation (cheap, holistic)
                      </SelectItem>
                      <SelectItem value="per-turn">
                        Per-turn — separate judge call + score per assistant turn (N× cost, finer-grained)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Per-turn writes one BenchmarkResult row per turn so you can
                    see which turn the model fumbles. Only useful when mode is
                    multi-turn.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="b-jtemp">Judge temperature</Label>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {judgeTemperature.toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    id="b-jtemp"
                    min={0}
                    max={2}
                    step={0.05}
                    value={[judgeTemperature]}
                    onValueChange={([v]) => setJudgeTemperature(v)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Lower is usually better — verdict stability over creativity.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="b-jmaxtok">Judge max_tokens</Label>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {judgeMaxTokens.toLocaleString()}
                    </span>
                  </div>
                  <Slider
                    id="b-jmaxtok"
                    min={128}
                    max={8_192}
                    step={128}
                    value={[judgeMaxTokens]}
                    onValueChange={([v]) => setJudgeMaxTokens(v)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Token budget for the judge's verdict + rationale.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="b-jretries">Judge retries on bad JSON</Label>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {judgeMaxRetries}
                    </span>
                  </div>
                  <Slider
                    id="b-jretries"
                    min={1}
                    max={10}
                    step={1}
                    value={[judgeMaxRetries]}
                    onValueChange={([v]) => setJudgeMaxRetries(v)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Total judge attempts when the response isn't valid JSON.
                    Each retry bumps the judge temperature by +0.1.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="b-conc">Parallel items</Label>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {concurrency}
                    </span>
                  </div>
                  <Slider
                    id="b-conc"
                    min={1}
                    max={16}
                    step={1}
                    value={[concurrency]}
                    onValueChange={([v]) => setConcurrency(v)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    How many conversations the worker scores in parallel.
                    Higher = faster, but watch the judges' rate limits.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline">mode: {mode}</Badge>
                {isMultiJudge && (
                  <Badge variant="outline">consensus: {consensusMethod}</Badge>
                )}
                {rubricId !== NONE && <Badge variant="outline">rubric: override</Badge>}
                {rubricId === NONE && defaultRubricId && (
                  <Badge variant="outline">rubric: default</Badge>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={pending || (isChatReplay && !configured)}>
          <Play className="mr-2 h-4 w-4" />
          {pending
            ? "Starting…"
            : isChatReplay
              ? "Start judge run"
              : "Start run"}
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
