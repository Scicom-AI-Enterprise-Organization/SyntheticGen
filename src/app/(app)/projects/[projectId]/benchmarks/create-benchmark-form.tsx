"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createBenchmark } from "./actions";

interface RunOption {
  id: string;
  name: string;
  model: string;
  acceptedCount: number;
  createdAt: string;
}
interface RubricOption {
  id: string;
  name: string;
  isPreset: boolean;
}

const NONE = "__none__";

export function CreateBenchmarkForm({
  projectId,
  runs,
  rubrics,
  card,
}: {
  projectId: string;
  runs: RunOption[];
  rubrics: RubricOption[];
  card?: { title: string; description?: string };
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"single-turn" | "multi-turn">("multi-turn");
  const [runId, setRunId] = useState<string>(NONE);
  const [limit, setLimit] = useState("50");
  const [defaultRubricId, setDefaultRubricId] = useState<string>(NONE);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (runs.length === 0) {
      setError("No runs in this project yet — generate some data first.");
      return;
    }
    const parsedLimit = Number(limit);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 2000) {
      setError("Limit must be between 1 and 2000");
      return;
    }
    const filter: Record<string, unknown> = {
      statuses: ["accepted"],
      limit: parsedLimit,
    };
    if (runId !== NONE) filter.runIds = [runId];

    start(async () => {
      const res = await createBenchmark({
        kind: "project-chat-replay",
        projectId,
        name,
        description: description || null,
        mode,
        filter,
        defaultRubricId: defaultRubricId === NONE ? null : defaultRubricId,
      });
      if ("error" in res && res.error) setError(res.error);
      else if ("ok" in res && res.ok && "id" in res) {
        router.push(`/projects/${projectId}/benchmarks/${res.id}`);
      }
    });
  }

  const fields = (
    <>
      <p className="text-xs text-muted-foreground">
        Pick a Run (or leave as <em>any accepted</em>) — its conversations are frozen as the eval
        set. Every benchmark run replays the same prompts through the candidate model and scores
        against the original assistant turns with your rubric + LLM judge.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bp-name">Name</Label>
          <Input
            id="bp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Malay support replay v1"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bp-mode">Replay mode</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <SelectTrigger id="bp-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single-turn">
                Single-turn — only replay first user message
              </SelectItem>
              <SelectItem value="multi-turn">
                Multi-turn — replay every recorded user turn in order
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="bp-desc">Description</Label>
          <Input
            id="bp-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this benchmark measures"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bp-run">Source run</Label>
          <Select value={runId} onValueChange={setRunId}>
            <SelectTrigger id="bp-run">
              <SelectValue placeholder="Any accepted conversation in project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Any accepted conversation in project</SelectItem>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} · {r.model} · {r.acceptedCount} accepted
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bp-limit">Sample size (1–2000)</Label>
          <Input
            id="bp-limit"
            type="number"
            min={1}
            max={2000}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
          />
          <p className="text-[10px] text-muted-foreground">
            Caps how many conversations get frozen into the eval set. Higher = slower / more
            expensive judging.
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="bp-rubric">Default rubric (optional)</Label>
          <Select value={defaultRubricId} onValueChange={setDefaultRubricId}>
            <SelectTrigger id="bp-rubric">
              <SelectValue placeholder="Pick a default rubric for new runs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No default — required per run</SelectItem>
              {rubrics.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                  {r.isPreset && " (preset)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rubrics.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No rubrics in this project yet. Create one under{" "}
              <a
                href={`/projects/${projectId}/rubrics`}
                className="underline hover:text-foreground"
              >
                Rubrics
              </a>
              .
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <Badge variant="outline">mode: {mode}</Badge>
        <Badge variant="outline">freezes ≤ {limit || 0} conversations</Badge>
      </div>
    </>
  );

  const errorBlock = error && (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive" role="alert">
      {error}
    </p>
  );
  const submitButton = (
    <Button type="submit" disabled={pending}>
      <Plus className="mr-2 h-4 w-4" />
      {pending ? "Freezing…" : "Create benchmark"}
    </Button>
  );

  if (card) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{card.title}</CardTitle>
            {card.description && (
              <CardDescription>{card.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {fields}
            {errorBlock}
          </CardContent>
        </Card>
        <div className="flex justify-end">{submitButton}</div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {fields}
      {errorBlock}
      {submitButton}
    </form>
  );
}
