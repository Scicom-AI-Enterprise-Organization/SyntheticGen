"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const NONE = "__none__";

export function StartRunForm({
  projectId,
  benchmarkId,
  benchmarkKind,
  defaultMode,
  defaultRubricId,
  providers,
  rubrics,
}: {
  projectId: string;
  benchmarkId: string;
  benchmarkKind: string;
  defaultMode?: "single-turn" | "multi-turn" | null;
  defaultRubricId?: string | null;
  providers: ProviderOption[];
  rubrics: RubricOption[];
}) {
  const router = useRouter();
  const isChatReplay = benchmarkKind === "project-chat-replay";

  // Chat-replay scores the EXISTING reference assistant turns from each
  // frozen conversation against the rubric — no candidate model is
  // re-invoked. Only the judge model + rubric + mode are configured.
  const [judgeProviderId, setJudgeProviderId] = useState(providers[0]?.id ?? "");
  const [judgeModel, setJudgeModel] = useState(providers[0]?.defaultModel ?? "");
  const [rubricId, setRubricId] = useState<string>(defaultRubricId ?? NONE);
  const [mode, setMode] = useState<"single-turn" | "multi-turn">(defaultMode ?? "multi-turn");
  // Judge sampling — lower temperature gives more deterministic verdicts;
  // 4k tokens is enough for verdict + rationale on most rubrics.
  const [judgeTemperature, setJudgeTemperature] = useState(0.2);
  const [judgeMaxTokens, setJudgeMaxTokens] = useState(4096);
  // Per-turn judging produces a separate BenchmarkResult per assistant
  // turn (N×cost, finer-grained scores). One-shot scores the whole
  // conversation in a single call (1×cost, holistic).
  const [judgeStrategy, setJudgeStrategy] = useState<"one-shot" | "per-turn">(
    // Per-turn gives the most useful drill-down — one rationale per
    // assistant turn — and is what most users want for dataset
    // curation. One-shot remains available for cheaper holistic runs.
    "per-turn",
  );
  // Number of judge attempts before accepting a malformed response.
  // Each retry bumps the judge temperature slightly so we don't
  // re-roll the same broken JSON. Default 3 = 1 attempt + 2 retries.
  const [judgeMaxRetries, setJudgeMaxRetries] = useState(3);
  // Run K items concurrently. Same model as conversation-generation:
  // bounded by an asyncio semaphore in the worker. 4 is a safe default
  // for most APIs; pushing it too high can rate-limit the judge model.
  const [concurrency, setConcurrency] = useState(4);

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onJudgeProviderChange(v: string) {
    setJudgeProviderId(v);
    const p = providers.find((x) => x.id === v);
    if (p?.defaultModel) setJudgeModel(p.defaultModel);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isChatReplay) {
      if (!judgeModel.trim()) {
        setError("Judge model required for chat-replay");
        return;
      }
      const effectiveRubric = rubricId === NONE ? null : rubricId;
      if (!effectiveRubric && !defaultRubricId) {
        setError("Pick a rubric — this benchmark has no default");
        return;
      }
    }

    start(async () => {
      const res = await startBenchmarkRun({
        projectId,
        benchmarkId,
        // BenchmarkRun's candidate columns are required by the schema, so
        // we reuse the judge values — the worker no longer treats them
        // as a separate model.
        providerCredentialId: judgeProviderId,
        model: judgeModel.trim(),
        ...(isChatReplay
          ? {
              judgeProviderCredentialId: judgeProviderId,
              judgeModel: judgeModel.trim(),
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
            candidate model is re-invoked. Configure the judge below.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="b-jprovider">Judge provider</Label>
              <Select value={judgeProviderId} onValueChange={onJudgeProviderChange}>
                <SelectTrigger id="b-jprovider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} <span className="ml-1 text-muted-foreground">({p.kind})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Use a strong scoring model (e.g. Claude Opus / GPT-4 / Qwen 72B).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-jmodel">Judge model</Label>
              <Input
                id="b-jmodel"
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
                placeholder="e.g. claude-opus-4-7, gpt-4o"
                required
              />
            </div>

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
                Each retry bumps the judge temperature by +0.1 so we
                don't re-roll the same broken output. 3 = 1 attempt + 2
                retries.
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
                Higher = faster, but watch the judge model's rate limit.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline">mode: {mode}</Badge>
            {rubricId !== NONE && <Badge variant="outline">rubric: override</Badge>}
            {rubricId === NONE && defaultRubricId && (
              <Badge variant="outline">rubric: default</Badge>
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={pending}>
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
