"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
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

const DIFFICULTIES = ["easy", "medium", "hard"];

export function RunWizard({
  projectId,
  taxonomy,
  personas,
  languageProfiles,
  providers,
  templates,
}: {
  projectId: string;
  taxonomy: Node[];
  personas: Persona[];
  languageProfiles: LP[];
  providers: Provider[];
  templates: Template[];
}) {
  const [name, setName] = useState("Run " + new Date().toISOString().slice(0, 16).replace("T", " "));
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [languageProfileId, setLanguageProfileId] = useState(languageProfiles[0]?.id ?? "");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [model, setModel] = useState(providers[0]?.defaultModel ?? "");
  const [nodeIds, setNodeIds] = useState<string[]>(taxonomy.length > 0 ? [taxonomy[0].id] : []);
  const [personaIds, setPersonaIds] = useState<string[]>(
    personas.length > 0 ? [personas[0].id] : [],
  );
  const [difficulties, setDifficulties] = useState<string[]>(["medium"]);
  const [rowsPerCell, setRowsPerCell] = useState(5);
  const [turns, setTurns] = useState(1);
  const [formalityPolicy, setFormalityPolicy] = useState<"inherit" | "formal" | "semi-formal" | "colloquial" | "mixed">(
    "inherit",
  );
  const [temperature, setTemperature] = useState(0.7);
  const [pending, start] = useTransition();

  const totalCells = nodeIds.length * personaIds.length * difficulties.length * rowsPerCell;

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
    if (totalCells === 0) {
      toast.error("Pick at least one taxonomy node, persona, and difficulty");
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
        taxonomyNodeIds: nodeIds,
        personaIds,
        difficulties,
        rowsPerCell,
        turns,
        formalityPolicy,
        temperature,
        topP: 1.0,
        maxTokens: 1024,
        seed: null,
      });
      if (res && "error" in res && res.error) toast.error(res.error);
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
          <Label>Temperature</Label>
          <Input
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Rows per cell</Label>
          <Input
            type="number"
            min={1}
            max={200}
            value={rowsPerCell}
            onChange={(e) => setRowsPerCell(Number(e.target.value))}
            required
          />
        </div>

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
            How many user↔assistant exchanges per conversation. Slice 1's
            single-turn worker honours <code>1</code>; use <strong>Flows</strong>{" "}
            for richer multi-turn graphs.
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

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>Difficulties ({difficulties.length} selected)</Label>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={
                difficulties.length === DIFFICULTIES.length
                  ? true
                  : difficulties.length === 0
                    ? false
                    : "indeterminate"
              }
              onCheckedChange={(v) =>
                setDifficulties(v === true ? [...DIFFICULTIES] : [])
              }
            />
            {difficulties.length === DIFFICULTIES.length ? "Unselect all" : "Select all"}
          </label>
        </div>
        <div className="flex gap-2">
          {DIFFICULTIES.map((d) => (
            <label key={d} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs">
              <Checkbox
                checked={difficulties.includes(d)}
                onCheckedChange={() => setDifficulties((arr) => toggleArr(arr, d))}
              />
              {d}
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        <span className="font-semibold">Total cells:</span>{" "}
        <span className="font-mono">
          {nodeIds.length} × {personaIds.length} × {difficulties.length} × {rowsPerCell} ={" "}
          <span className="font-bold">{totalCells}</span>
        </span>
        {totalCells > 1000 && (
          <span className="ml-3 text-amber-600">⚠ exceeds 1000-cell slice 1 cap</span>
        )}
      </div>

      <Button type="submit" disabled={pending || totalCells === 0 || totalCells > 1000} size="lg">
        <Play className="mr-2 h-4 w-4" />
        {pending ? "Starting…" : `Start run (${totalCells} samples)`}
      </Button>
    </form>
  );
}
