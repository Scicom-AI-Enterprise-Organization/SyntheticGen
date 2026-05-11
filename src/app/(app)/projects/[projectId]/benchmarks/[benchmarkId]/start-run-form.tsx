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

  // Candidate
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [model, setModel] = useState(providers[0]?.defaultModel ?? "");

  // Chat-replay-only
  const [judgeProviderId, setJudgeProviderId] = useState(providers[0]?.id ?? "");
  const [judgeModel, setJudgeModel] = useState(providers[0]?.defaultModel ?? "");
  const [rubricId, setRubricId] = useState<string>(defaultRubricId ?? NONE);
  const [mode, setMode] = useState<"single-turn" | "multi-turn">(defaultMode ?? "multi-turn");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("4096");

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onProviderChange(v: string) {
    setProviderId(v);
    const p = providers.find((x) => x.id === v);
    if (p?.defaultModel) setModel(p.defaultModel);
  }
  function onJudgeProviderChange(v: string) {
    setJudgeProviderId(v);
    const p = providers.find((x) => x.id === v);
    if (p?.defaultModel) setJudgeModel(p.defaultModel);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!model.trim()) {
      setError("Candidate model required");
      return;
    }
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
        providerCredentialId: providerId,
        model: model.trim(),
        ...(isChatReplay
          ? {
              judgeProviderCredentialId: judgeProviderId,
              judgeModel: judgeModel.trim(),
              rubricId: rubricId === NONE ? null : rubricId,
              mode,
              samplingParams: {
                temperature: Number(temperature),
                max_tokens: Number(maxTokens),
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
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="b-provider">Candidate provider</Label>
          <Select value={providerId} onValueChange={onProviderChange}>
            <SelectTrigger id="b-provider">
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
        </div>
        <div className="space-y-2">
          <Label htmlFor="b-model">Candidate model</Label>
          <Input
            id="b-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. gpt-4o-mini, qwen/qwen2.5-7b-instruct"
            required
          />
        </div>
        {!isChatReplay && (
          <div className="self-end">
            <Button type="submit" disabled={pending}>
              <Play className="mr-2 h-4 w-4" />
              {pending ? "Starting…" : "Start run"}
            </Button>
          </div>
        )}
      </div>

      {isChatReplay && (
        <>
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
                Use a stronger model than the candidate (e.g. Claude Opus / GPT-4 / Qwen 72B).
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
                  <SelectItem value="single-turn">Single-turn</SelectItem>
                  <SelectItem value="multi-turn">Multi-turn</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="b-temp">Candidate temperature</Label>
              <Input
                id="b-temp"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-maxtok">Candidate max_tokens</Label>
              <Input
                id="b-maxtok"
                type="number"
                min={1}
                max={64000}
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="outline">mode: {mode}</Badge>
            {rubricId !== NONE && <Badge variant="outline">rubric: override</Badge>}
            {rubricId === NONE && defaultRubricId && (
              <Badge variant="outline">rubric: default</Badge>
            )}
          </div>

          <Button type="submit" disabled={pending}>
            <Play className="mr-2 h-4 w-4" />
            {pending ? "Starting…" : "Start chat-replay run"}
          </Button>
        </>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
