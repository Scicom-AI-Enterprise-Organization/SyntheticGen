"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { startBootstrap } from "./actions";

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string | null;
}

const SCOPE_ITEMS: Array<{
  key: keyof Scope;
  label: string;
  hint: string;
}> = [
  { key: "taxonomy", label: "Taxonomy nodes", hint: "8 topic nodes" },
  { key: "languages", label: "Language profiles", hint: "2 register profiles" },
  { key: "personas", label: "Personas", hint: "4 demographically varied personas" },
  { key: "templates", label: "Templates", hint: "System + user-seed templates" },
  { key: "tools", label: "Tools", hint: "3 function-calling tool defs" },
  { key: "flows", label: "Flows", hint: "1 multi-turn flow DAG" },
  { key: "rubrics", label: "Rubrics", hint: "1 benchmark scoring rubric" },
  {
    key: "benchmarks",
    label: "Benchmarks",
    hint: "1 chat-replay benchmark wired to the rubric",
  },
];

type Scope = {
  taxonomy: boolean;
  languages: boolean;
  personas: boolean;
  templates: boolean;
  tools: boolean;
  flows: boolean;
  rubrics: boolean;
  benchmarks: boolean;
};

const DEFAULT_SCOPE: Scope = {
  taxonomy: true,
  languages: true,
  personas: true,
  templates: true,
  tools: true,
  flows: true,
  rubrics: true,
  benchmarks: true,
};

const EXAMPLE_PROMPT =
  "Malaysian retail-bank customer support — formal Bahasa baku for general inquiries, and casual Manglish for younger demographics. Should cover billing, account access, fraud, and product queries.";

export function StartForm({
  projectId,
  providers,
}: {
  projectId: string;
  providers: ProviderOption[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [model, setModel] = useState(providers[0]?.defaultModel ?? "");
  // Sampling knobs as numbers (driven by range sliders). Defaults pick up
  // the Python kind defaults — change them per-run on the form, change the
  // constants here if you want different defaults across the board.
  const [temperature, setTemperature] = useState<number>(0.3);
  const [maxTokens, setMaxTokens] = useState<number>(4096);
  const [scope, setScope] = useState<Scope>(DEFAULT_SCOPE);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggleScope(k: keyof Scope) {
    setScope((s) => ({ ...s, [k]: !s[k] }));
  }

  function onProviderChange(id: string) {
    setProviderId(id);
    const p = providers.find((x) => x.id === id);
    setModel(p?.defaultModel ?? "");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const trimmed = prompt.trim();
    if (trimmed.length < 8) {
      setErr("Prompt must be at least 8 characters");
      return;
    }
    if (!providerId) {
      setErr("Pick a provider");
      return;
    }
    if (!Object.values(scope).some(Boolean)) {
      setErr("Pick at least one entity to generate");
      return;
    }
    // Sliders are clamped to valid ranges by their min/max, so no extra
    // validation is needed beyond the type — but we still bail defensively
    // if something pathological got into state.
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      setErr("Temperature must be between 0 and 2");
      return;
    }
    if (
      !Number.isInteger(maxTokens) ||
      maxTokens < 256 ||
      maxTokens > 64000
    ) {
      setErr("Max tokens must be an integer between 256 and 64000");
      return;
    }
    start(async () => {
      const res = await startBootstrap({
        projectId,
        prompt: trimmed,
        providerId,
        model: model || null,
        temperature,
        maxTokens,
        scope,
      });
      if ("error" in res && res.error) {
        setErr(res.error);
        if ("runningJobId" in res && typeof res.runningJobId === "string") {
          router.push(`?jobId=${res.runningJobId}`);
        }
        return;
      }
      if ("ok" in res && res.ok) {
        router.push(`?jobId=${res.id}`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            One-prompt project bootstrap
          </CardTitle>
          <CardDescription>
            Describe what the project is for in plain English. The orchestrator
            will generate taxonomy nodes, language profiles, personas, prompt
            templates, tool defs, a flow, a rubric, and a default benchmark —
            in that order, all wired together. Items are <strong>added</strong>{" "}
            alongside whatever already exists; nothing is deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt">Prompt</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPrompt(EXAMPLE_PROMPT)}
                title="Fill the prompt with a sensible example"
              >
                Use example
              </Button>
            </div>
            <Textarea
              id="prompt"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`e.g. ${EXAMPLE_PROMPT}`}
              className="font-normal"
            />
            <p className="text-[11px] text-muted-foreground">
              The more concrete the domain, locale, register, and topics you
              mention, the less drift across the generated entities.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                value={providerId}
                onChange={(e) => onProviderChange(e.target.value)}
                className="border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                {providers.length === 0 && (
                  <option value="">(no providers configured)</option>
                )}
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.defaultModel ? ` (${p.defaultModel})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model (override)</Label>
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="leave blank for default"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label
                htmlFor="temperature"
                className="flex items-center justify-between"
              >
                <span>Temperature</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {temperature.toFixed(2)}
                </span>
              </Label>
              <input
                id="temperature"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>0 · deterministic</span>
                <span>1</span>
                <span>2 · chaotic</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="max-tokens"
                className="flex items-center justify-between"
              >
                <span>Max tokens per call</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {maxTokens.toLocaleString()}
                </span>
              </Label>
              <input
                id="max-tokens"
                type="range"
                min={256}
                max={32000}
                step={256}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>256</span>
                <span>8k</span>
                <span>16k</span>
                <span>32k</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Generate</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCOPE_ITEMS.map((item) => (
                <label
                  key={item.key}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background p-2.5 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={scope[item.key]}
                    onCheckedChange={() => toggleScope(item.key)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {item.label}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {item.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {err && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
              {err}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || providers.length === 0}>
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {pending ? "Starting…" : "Generate everything"}
        </Button>
      </div>
    </form>
  );
}
