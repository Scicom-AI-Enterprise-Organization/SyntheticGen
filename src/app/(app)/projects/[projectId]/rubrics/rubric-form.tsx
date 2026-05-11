"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AiAssistButton } from "@/components/ai-assist-button";
import { createRubric, updateRubric } from "./actions";

export interface RubricAxis {
  key: string;
  name: string;
  description: string;
  scale: number;
  weight: number;
  examples?: Array<{ score: number; output: string; reason?: string | null }> | null;
}

export interface RubricFormInitial {
  id?: string;
  name?: string;
  description?: string | null;
  axes?: RubricAxis[];
}

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string | null;
}

const BLANK_AXIS = (): RubricAxis => ({
  key: "",
  name: "",
  description: "",
  scale: 5,
  weight: 1,
  examples: null,
});

const DEFAULT_AXES: RubricAxis[] = [
  {
    key: "language_fidelity",
    name: "Language Fidelity",
    description:
      "Does the candidate stay in the target language (primary + permitted code-switches)? Penalise drift into the wrong language.",
    scale: 5,
    weight: 1,
  },
  {
    key: "register_match",
    name: "Register Match",
    description:
      "Does the tone/formality match the reference (formal Malay vs colloquial Manglish vs casual mixed)?",
    scale: 5,
    weight: 1,
  },
  {
    key: "helpfulness",
    name: "Helpfulness",
    description:
      "Does the response actually answer the user's request with correct, specific, actionable content?",
    scale: 5,
    weight: 1,
  },
  {
    key: "faithfulness_to_reference",
    name: "Faithfulness to Reference",
    description:
      "Does the candidate convey the same information as the reference answer? Allow stylistic differences; penalise factual divergence.",
    scale: 5,
    weight: 1,
  },
];

export function RubricForm({
  projectId,
  providers,
  initial,
}: {
  projectId: string;
  providers: ProviderOption[];
  initial?: RubricFormInitial;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [axes, setAxes] = useState<RubricAxis[]>(
    initial?.axes && initial.axes.length > 0 ? initial.axes : DEFAULT_AXES,
  );
  const [aiDrafted, setAiDrafted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function updateAxis(idx: number, patch: Partial<RubricAxis>) {
    setAxes((cur) => cur.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function removeAxis(idx: number) {
    setAxes((cur) => cur.filter((_, i) => i !== idx));
  }
  function addAxis() {
    setAxes((cur) => [...cur, BLANK_AXIS()]);
  }
  function moveAxis(idx: number, dir: -1 | 1) {
    setAxes((cur) => {
      const next = [...cur];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters");
      return;
    }
    if (axes.length === 0) {
      setError("Add at least one axis");
      return;
    }
    for (const [i, a] of axes.entries()) {
      if (!/^[a-z][a-z0-9_]*$/.test(a.key)) {
        setError(`Axis ${i + 1}: key must be lowercase snake_case (got "${a.key}")`);
        return;
      }
      if (!a.name.trim()) {
        setError(`Axis ${i + 1}: name is required`);
        return;
      }
      if (!a.description.trim()) {
        setError(`Axis ${i + 1}: description is required`);
        return;
      }
      if (!Number.isFinite(a.scale) || a.scale < 2 || a.scale > 10) {
        setError(`Axis ${i + 1}: scale must be between 2 and 10`);
        return;
      }
      if (!Number.isFinite(a.weight) || a.weight < 0) {
        setError(`Axis ${i + 1}: weight must be ≥ 0`);
        return;
      }
    }
    const keys = new Set(axes.map((a) => a.key));
    if (keys.size !== axes.length) {
      setError("Axis keys must be unique");
      return;
    }

    start(async () => {
      const payload = {
        projectId,
        name: name.trim(),
        description: description.trim() || null,
        axes,
        aiDrafted,
      };
      const res = isEdit
        ? await updateRubric({ ...payload, id: initial!.id! })
        : await createRubric(payload);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if (isEdit) {
        router.refresh();
      } else if ("id" in res && res.id) {
        router.push(`/projects/${projectId}/rubrics/${res.id}`);
      }
    });
  }

  function applyAi(data: Record<string, unknown>) {
    if (typeof data.name === "string") setName(data.name);
    if (typeof data.description === "string") setDescription(data.description);
    if (Array.isArray(data.axes)) {
      const parsed: RubricAxis[] = [];
      for (const raw of data.axes) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const key = typeof r.key === "string" ? r.key : "";
        const nameField = typeof r.name === "string" ? r.name : "";
        const desc = typeof r.description === "string" ? r.description : "";
        const scale =
          typeof r.scale === "number" ? r.scale : Number.parseInt(String(r.scale ?? "5"), 10);
        const weight =
          typeof r.weight === "number" ? r.weight : Number.parseFloat(String(r.weight ?? "1"));
        const examples = Array.isArray(r.examples)
          ? (r.examples as unknown[])
              .map((e) => {
                if (!e || typeof e !== "object") return null;
                const er = e as Record<string, unknown>;
                const score =
                  typeof er.score === "number" ? er.score : Number.parseInt(String(er.score), 10);
                const output = typeof er.output === "string" ? er.output : "";
                const reason = typeof er.reason === "string" ? er.reason : null;
                if (!Number.isFinite(score) || !output) return null;
                return { score, output, reason };
              })
              .filter((e): e is NonNullable<typeof e> => e !== null)
          : null;
        if (!key || !nameField || !desc) continue;
        parsed.push({
          key,
          name: nameField,
          description: desc,
          scale: Number.isFinite(scale) ? scale : 5,
          weight: Number.isFinite(weight) ? weight : 1,
          examples: examples && examples.length > 0 ? examples : null,
        });
      }
      if (parsed.length > 0) {
        setAxes(parsed);
        setAiDrafted(true);
      }
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Rubrics define the axes an LLM judge uses to score candidate models in chat-replay
          benchmarks.
        </p>
        <AiAssistButton
          projectId={projectId}
          kind="benchmark-rubric"
          providers={providers}
          placeholder="A rubric for benchmarking Malaysian-Malay customer-support assistants on casual register, accuracy, and refusal to drift into Indonesian."
          onApply={applyAi}
          buttonLabel="Fill with AI"
          randomizePrompt={{
            description:
              "Invent ONE concise rubric prompt for benchmarking a smaller chat model against a stronger one on Malaysia-focused synthetic conversations. Mention the language (formal Malay / colloquial Manglish / mixed), the domain (banking / telco / customer-support / etc.), and what you'd specifically punish (drift into Indonesian, English-only replies, omitted information, wrong tool calls). ONE or TWO sentences. This will be used as the prompt to a downstream form-filling LLM.",
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="r-name">Name</Label>
          <Input
            id="r-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Malaysian Casual Support"
            required
            minLength={2}
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="r-desc">Description</Label>
          <Input
            id="r-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this rubric measures"
            maxLength={1000}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Axes ({axes.length})</Label>
          <Button type="button" size="sm" variant="outline" onClick={addAxis}>
            <Plus className="mr-1 h-3 w-3" /> Add axis
          </Button>
        </div>

        <div className="space-y-3">
          {axes.map((axis, idx) => (
            <AxisRow
              key={idx}
              axis={axis}
              idx={idx}
              onChange={(patch) => updateAxis(idx, patch)}
              onRemove={() => removeAxis(idx)}
              onMove={(dir) => moveAxis(idx, dir)}
              canMoveUp={idx > 0}
              canMoveDown={idx < axes.length - 1}
            />
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create rubric"}
        </Button>
        {aiDrafted && !isEdit && (
          <Badge variant="outline" className="text-[10px]">
            AI-drafted
          </Badge>
        )}
      </div>
    </form>
  );
}

function AxisRow({
  axis,
  idx,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  axis: RubricAxis;
  idx: number;
  onChange: (patch: Partial<RubricAxis>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const exampleCount = axis.examples?.length ?? 0;
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="flex flex-col gap-0.5 pt-1 text-muted-foreground">
          <button
            type="button"
            aria-label="Move axis up"
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
            className="leading-none hover:text-foreground disabled:opacity-30"
          >
            <GripVertical className="h-3 w-3 -rotate-90" />
          </button>
          <button
            type="button"
            aria-label="Move axis down"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            className="leading-none hover:text-foreground disabled:opacity-30"
          >
            <GripVertical className="h-3 w-3 rotate-90" />
          </button>
        </div>
        <div className="flex-1 grid gap-2 sm:grid-cols-[1fr_1fr_90px_90px]">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">
              Key (snake_case)
            </Label>
            <Input
              value={axis.key}
              onChange={(e) => onChange({ key: e.target.value.toLowerCase() })}
              placeholder="language_fidelity"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Display name</Label>
            <Input
              value={axis.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Language Fidelity"
              className="text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Scale (1–N)</Label>
            <Input
              type="number"
              min={2}
              max={10}
              value={axis.scale}
              onChange={(e) => onChange({ scale: Number(e.target.value) })}
              className="text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Weight</Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={axis.weight}
              onChange={(e) => onChange({ weight: Number(e.target.value) })}
              className="text-xs"
            />
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove axis ${idx + 1}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="ml-6 space-y-2">
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">
            Description (judge sees this)
          </Label>
          <Textarea
            value={axis.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={2}
            placeholder="Does the candidate stay in target language? Penalise drift into Indonesian."
            className="text-xs"
          />
        </div>

        {exampleCount > 0 && (
          <details className="rounded border border-border/60 bg-muted/20">
            <summary className="cursor-pointer select-none px-2 py-1 text-[10px] text-muted-foreground">
              {exampleCount} example{exampleCount === 1 ? "" : "s"} (AI-supplied)
            </summary>
            <div className="space-y-1 border-t border-border/60 px-2 py-2 text-[10px]">
              {axis.examples!.map((ex, i) => (
                <div key={i} className="rounded border border-border/40 bg-background/60 p-1.5">
                  <div className="mb-0.5 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[9px]">
                      score: {ex.score}
                    </Badge>
                    {ex.reason && (
                      <span className="text-[10px] italic text-muted-foreground">{ex.reason}</span>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-snug">
                    {ex.output}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
