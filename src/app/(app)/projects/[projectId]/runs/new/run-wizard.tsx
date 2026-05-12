"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Play, AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { createAndStartRun } from "../actions";

interface Node {
  id: string;
  name: string;
  path: string;
}
interface Persona {
  id: string;
  name: string;
  formality: string | null;
  languageProfileId: string | null;
}
interface LP {
  id: string;
  name: string;
  register: string;
  allowParticles: boolean;
  primary: string;
}
interface Provider {
  id: string;
  name: string;
  kind: string;
  defaultModel: string | null;
}
interface Template {
  id: string;
  name: string;
  kind: string;
}
interface Tool {
  id: string;
  name: string;
  description: string | null;
  localePresets: string[];
}
interface Flow {
  id: string;
  name: string;
  version: number;
}


export function RunWizard({
  projectId,
  taxonomy,
  personas,
  languageProfiles,
  providers,
  templates,
  tools,
  flows,
}: {
  projectId: string;
  taxonomy: Node[];
  personas: Persona[];
  languageProfiles: LP[];
  providers: Provider[];
  templates: Template[];
  tools: Tool[];
  flows: Flow[];
}) {
  // SSR-stable default. `new Date()` would tick between server render and
  // hydrate, breaking Radix's useId-based aria-controls on every Select. Fill
  // the timestamp on mount instead — by then no SSR comparison is happening.
  const [name, setName] = useState("Run");
  useEffect(() => {
    setName((cur) =>
      cur === "Run"
        ? "Run " + new Date().toISOString().slice(0, 16).replace("T", " ")
        : cur,
    );
  }, []);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [languageProfileId, setLanguageProfileId] = useState(languageProfiles[0]?.id ?? "");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [model, setModel] = useState(providers[0]?.defaultModel ?? "");
  const [nodeIds, setNodeIds] = useState<string[]>(taxonomy.length > 0 ? [taxonomy[0].id] : []);
  const [personaIds, setPersonaIds] = useState<string[]>(
    personas.length > 0 ? [personas[0].id] : [],
  );
  const [rowsPerCell, setRowsPerCell] = useState(5);
  const [turns, setTurns] = useState(1);
  const [formalityPolicy, setFormalityPolicy] = useState<"inherit" | "formal" | "semi-formal" | "colloquial" | "mixed">(
    "inherit",
  );
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [relatedTopics, setRelatedTopics] = useState(0);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [flowIds, setFlowIds] = useState<string[]>([]);
  // Explicit user choice: single-turn manual grid vs flow-driven multi-turn.
  // Flow-driven hides turns/relatedTopics/taxonomy/tools; the flow owns all of that.
  const [mode, setMode] = useState<"single" | "flow">("single");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const flowMode = mode === "flow";

  // In flow mode the "first axis" of the grid is flows instead of taxonomy
  // nodes; everything else still combines.
  const primaryAxis = flowMode ? flowIds.length : nodeIds.length;
  const totalCells = primaryAxis * personaIds.length * rowsPerCell;

  const lp = languageProfiles.find((p) => p.id === languageProfileId) ?? null;
  const formalityWarn = useMemo(() => {
    if (!lp) return null;
    if (formalityPolicy === "inherit") return null;
    if (formalityPolicy === "formal" && lp.allowParticles) {
      return `Run is locked to "formal" but the chosen profile permits colloquial particles — the run override will force formality.`;
    }
    if (formalityPolicy === "colloquial" && !lp.allowParticles) {
      return `Run is set to "colloquial" but the chosen profile bans particles — the run override will permit them.`;
    }
    return null;
  }, [lp, formalityPolicy]);

  function toggleArr(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (totalCells === 0) {
      setSubmitError(
        flowMode
          ? "Pick at least one flow and persona."
          : "Pick at least one taxonomy node and persona.",
      );
      return;
    }
    start(async () => {
      const res = await createAndStartRun({
        projectId,
        name,
        description: null,
        templateId,
        languageProfileId,
        providerCredentialId: providerId,
        model,
        taxonomyNodeIds: flowMode ? [] : nodeIds,
        personaIds,
        rowsPerCell,
        turns: flowMode ? 1 : turns,
        relatedTopics: flowMode ? 0 : relatedTopics,
        toolIds: flowMode ? [] : toolIds,
        flowIds,
        formalityPolicy,
        temperature,
        topP: 1.0,
        maxTokens,
        seed: null,
      });
      if (res && "error" in res && res.error) setSubmitError(res.error);
      // Successful path redirects in the action.
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="r-name">Run name</Label>
          <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div className="space-y-2">
          <Label>Template</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} <span className="ml-1 text-muted-foreground">({t.kind})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Language profile</Label>
          <Select value={languageProfileId} onValueChange={setLanguageProfileId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languageProfiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {lp && (
            <div className="text-xs text-muted-foreground">
              {lp.primary} · {lp.register} ·{" "}
              {lp.allowParticles ? (
                <span>particles OK</span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" /> no particles
                </span>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Provider</Label>
          <Select
            value={providerId}
            onValueChange={(v) => {
              setProviderId(v);
              const p = providers.find((x) => x.id === v);
              if (p?.defaultModel) setModel(p.defaultModel);
            }}
          >
            <SelectTrigger>
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
          <Label>Model</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            required
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="r-temp">Temperature</Label>
            <span className="font-mono text-xs text-muted-foreground">
              {temperature.toFixed(2)}
            </span>
          </div>
          <input
            id="r-temp"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="text-xs text-muted-foreground">
            0 = deterministic, 1 = balanced, 2 = wildly creative.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Conversations per combination</Label>
          <Input
            type="number"
            min={1}
            max={200}
            value={rowsPerCell}
            onChange={(e) => setRowsPerCell(Number(e.target.value))}
            required
          />
          <p className="text-xs text-muted-foreground">
            How many conversations to generate for each (taxonomy node × persona)
            combination. Total cells = nodes × personas × this number.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="r-maxtok">Max output tokens</Label>
            <span className="font-mono text-xs text-muted-foreground">
              {maxTokens.toLocaleString()}
            </span>
          </div>
          <input
            id="r-maxtok"
            type="range"
            min={256}
            max={64000}
            step={256}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="text-xs text-muted-foreground">
            Sent as <code>max_tokens</code> on every generation call. Bump higher
            for reasoning models so thinking + answer both fit.
          </p>
        </div>

      </div>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4" />
          Formality lock
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Overrides per-persona / per-profile formality for this run only. Use
          <code className="mx-1">formal</code> to enforce a strict register for enterprise output.
        </p>
        <Select
          value={formalityPolicy}
          onValueChange={(v) => setFormalityPolicy(v as typeof formalityPolicy)}
        >
          <SelectTrigger className="w-[280px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit (Persona → Profile → Project)</SelectItem>
            <SelectItem value="formal">Force formal (no particles)</SelectItem>
            <SelectItem value="semi-formal">Force semi-formal</SelectItem>
            <SelectItem value="colloquial">Force colloquial (particles OK)</SelectItem>
            <SelectItem value="mixed">Force mixed</SelectItem>
          </SelectContent>
        </Select>
        {formalityWarn && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{formalityWarn}</span>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>Personas ({personaIds.length} selected)</Label>
          {personas.length > 0 && (
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={
                  personaIds.length === personas.length
                    ? true
                    : personaIds.length === 0
                      ? false
                      : "indeterminate"
                }
                onCheckedChange={(v) =>
                  setPersonaIds(v === true ? personas.map((p) => p.id) : [])
                }
              />
              {personaIds.length === personas.length ? "Unselect all" : "Select all"}
            </label>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 sm:grid-cols-3">
          {personas.map((p) => (
            <label key={p.id} className="flex items-start gap-2 text-xs">
              <Checkbox
                checked={personaIds.includes(p.id)}
                onCheckedChange={() => setPersonaIds((arr) => toggleArr(arr, p.id))}
              />
              <span>
                {p.name}
                {p.formality && (
                  <Badge variant="outline" className="ml-1 text-[9px]">
                    {p.formality}
                  </Badge>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "flow")}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="single">Single-turn (manual grid)</TabsTrigger>
          <TabsTrigger value="flow" disabled={flows.length === 0}>
            Flow-driven {flows.length === 0 && "(no published flows)"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="space-y-6 pt-2">
          <p className="text-xs text-muted-foreground">
            Conversations are generated from <strong>Taxonomy × Persona × Difficulty</strong>{" "}
            cells, each with optional tool-use. Switch to <strong>Flow-driven</strong>{" "}
            for multi-turn graph-style runs.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Turns per conversation</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={turns}
                onChange={(e) => setTurns(Number(e.target.value))}
                required
              />
              <p className="text-xs text-muted-foreground">
                Only meaningful for the single-turn pipeline. Slice 1 honours{" "}
                <code>1</code>.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Related topics per conversation</Label>
              <Input
                type="number"
                min={0}
                max={6}
                value={relatedTopics}
                onChange={(e) => setRelatedTopics(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Inject N additional taxonomy node names per conversation as{" "}
                <code>{"{{taxonomy.related}}"}</code> in the template.
                Conversation is still tagged with the primary node only.{" "}
                <code>0</code> = strictly single-topic.
              </p>
              <p className="text-xs text-muted-foreground">
                <strong>Tip:</strong> this doesn't replace primaries — the grid
                still iterates every selected taxonomy node. Keep more primaries
                for a wider tag distribution; drop a few and bump this for more
                cross-topic conversations on fewer tags.
              </p>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Taxonomy nodes ({nodeIds.length} selected)</Label>
              {taxonomy.length > 0 && (
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={
                      nodeIds.length === taxonomy.length
                        ? true
                        : nodeIds.length === 0
                          ? false
                          : "indeterminate"
                    }
                    onCheckedChange={(v) =>
                      setNodeIds(v === true ? taxonomy.map((n) => n.id) : [])
                    }
                  />
                  {nodeIds.length === taxonomy.length ? "Unselect all" : "Select all"}
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 sm:grid-cols-3">
              {taxonomy.map((n) => (
                <label key={n.id} className="flex items-start gap-2 text-xs">
                  <Checkbox
                    checked={nodeIds.includes(n.id)}
                    onCheckedChange={() => setNodeIds((arr) => toggleArr(arr, n.id))}
                  />
                  <span>{n.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Tools ({toolIds.length} selected)</Label>
              {tools.length > 0 && (
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={
                      toolIds.length === tools.length
                        ? true
                        : toolIds.length === 0
                          ? false
                          : "indeterminate"
                    }
                    onCheckedChange={(v) =>
                      setToolIds(v === true ? tools.map((t) => t.id) : [])
                    }
                  />
                  {toolIds.length === tools.length ? "Unselect all" : "Select all"}
                </label>
              )}
            </div>
            {tools.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                No tools in this project's catalog yet. Add some under{" "}
                <strong>Tools</strong> to expose function-calling.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
                {tools.map((t) => (
                  <label key={t.id} className="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={toolIds.includes(t.id)}
                      onCheckedChange={() => setToolIds((arr) => toggleArr(arr, t.id))}
                    />
                    <span className="min-w-0">
                      <span className="font-mono">{t.name}</span>
                      {t.localePresets.length > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          [{t.localePresets.join(", ")}]
                        </span>
                      )}
                      {t.description && (
                        <span className="block truncate text-muted-foreground">
                          {t.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="flow" className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground">
            Each conversation is driven by the chosen flow's graph — turns,
            tool calls, and topic branching all come from the flow itself, so
            taxonomy/tools/turns/related-topics aren't needed here.
          </p>

          {flows.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              No published flows yet. Publish a flow under{" "}
              <strong>Flows</strong> first.
            </p>
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Flows ({flowIds.length} selected)</Label>
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={
                      flowIds.length === flows.length
                        ? true
                        : flowIds.length === 0
                          ? false
                          : "indeterminate"
                    }
                    onCheckedChange={(v) =>
                      setFlowIds(v === true ? flows.map((f) => f.id) : [])
                    }
                  />
                  {flowIds.length === flows.length ? "Unselect all" : "Select all"}
                </label>
              </div>
              <div className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
                {flows.map((f) => (
                  <label key={f.id} className="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={flowIds.includes(f.id)}
                      onCheckedChange={() => setFlowIds((arr) => toggleArr(arr, f.id))}
                    />
                    <span className="min-w-0">
                      <span className="font-mono">{f.name}</span>
                      <Badge variant="outline" className="ml-1 text-[9px]">
                        v{f.version}
                      </Badge>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        <div>
          <span className="font-semibold">Total cells:</span>{" "}
          <span className="font-mono">
            {flowMode ? (
              <>
                <span title="flows">{flowIds.length}</span>
              </>
            ) : (
              <span title="taxonomy nodes">{nodeIds.length}</span>
            )}{" "}
            × {personaIds.length} × {rowsPerCell} ={" "}
            <span className="font-bold">{totalCells}</span>
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            ({flowMode ? "flows" : "nodes"} × personas × conversations-per-combination)
          </span>
          {totalCells > 1000 && (
            <span className="ml-3 text-amber-600">⚠ exceeds 1000-cell slice 1 cap</span>
          )}
        </div>
        {!flowMode && relatedTopics > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Related topics ({relatedTopics}) only enrich each conversation's
            context — they don't change the cell count. Each of the{" "}
            <span className="font-mono">{totalCells}</span> conversations is
            still tagged with one primary node.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {submitError && (
          <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {submitError}
          </p>
        )}
        <Button type="submit" disabled={pending || totalCells === 0 || totalCells > 1000} size="lg">
          <Play className="mr-2 h-4 w-4" />
          {pending ? "Starting…" : `Start run (${totalCells} samples)`}
        </Button>
      </div>
    </form>
  );
}
