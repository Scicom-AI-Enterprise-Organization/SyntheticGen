"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Plus, Trash2, RefreshCw, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setProjectEnsembleJudges } from "./actions";

interface ProviderOption {
  id: string;
  name: string;
  kind: string;
  defaultModel: string | null;
}

interface JudgeRow {
  providerCredentialId: string;
  model: string;
}

// Project-level ensemble judges configuration. One source of truth for
// every "Re-judge with ensemble" pass across every benchmark + run in
// the project. Configured once here, never re-picked per run.
//
// Saved as a JSON array on Project.ensembleJudges (see prisma schema)
// so adding/removing judges doesn't need a migration. Validation +
// audit happens in the setProjectEnsembleJudges server action.
export function EnsembleJudgesCard({
  projectId,
  providers,
  initialJudges,
  disabled,
}: {
  projectId: string;
  providers: ProviderOption[];
  initialJudges: JudgeRow[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [judges, setJudges] = useState<JudgeRow[]>(() => {
    if (initialJudges.length > 0) return initialJudges;
    // Sensible starting point: two empty rows so the user sees the
    // ensemble pattern (need ≥2 judges for meaningful consensus).
    return [
      { providerCredentialId: providers[0]?.id ?? "", model: providers[0]?.defaultModel ?? "" },
      { providerCredentialId: providers[0]?.id ?? "", model: "" },
    ];
  });
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function addJudge() {
    setJudges((prev) => [
      ...prev,
      { providerCredentialId: providers[0]?.id ?? "", model: "" },
    ]);
  }
  function removeJudge(i: number) {
    setJudges((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setJudge(i: number, patch: Partial<JudgeRow>) {
    setJudges((prev) =>
      prev.map((j, idx) => (idx === i ? { ...j, ...patch } : j)),
    );
  }

  function onSave() {
    setError(null);
    setSuccess(null);
    // Drop empty rows before sending; allow saving zero (clears the list).
    const clean = judges.filter(
      (j) => j.providerCredentialId && j.model.trim(),
    );
    start(async () => {
      const res = await setProjectEnsembleJudges({
        projectId,
        judges: clean.map((j) => ({
          providerCredentialId: j.providerCredentialId,
          model: j.model.trim(),
        })),
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setSuccess(
        clean.length >= 2
          ? `Saved ${clean.length} judges. Re-judge with ensemble is now enabled across all runs.`
          : clean.length === 0
            ? "Cleared. Re-judge with ensemble is disabled."
            : `Saved 1 judge — add another to enable Re-judge with ensemble (needs ≥2).`,
      );
      router.refresh();
    });
  }

  const completeCount = judges.filter(
    (j) => j.providerCredentialId && j.model.trim(),
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Ensemble judges
        </CardTitle>
        <CardDescription>
          Project-wide multi-judge config used by the &quot;Re-judge with
          ensemble&quot; flow on every completed benchmark run. Pick 2+
          different models (e.g. Claude + GPT-4 + the original judge) so the
          consensus and disagreement signal is meaningful. Empty list
          disables the ensemble button across all runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {judges.map((j, i) => (
            <div
              key={i}
              className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_auto]"
            >
              <div>
                <Label htmlFor={`ej-prov-${i}`} className="sr-only">
                  Provider {i + 1}
                </Label>
                <Select
                  value={j.providerCredentialId}
                  onValueChange={(v) => {
                    const p = providers.find((x) => x.id === v);
                    setJudge(i, {
                      providerCredentialId: v,
                      ...(p?.defaultModel && !j.model
                        ? { model: p.defaultModel }
                        : {}),
                    });
                  }}
                  disabled={disabled || pending}
                >
                  <SelectTrigger id={`ej-prov-${i}`}>
                    <SelectValue placeholder="Pick provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{" "}
                        <span className="ml-1 text-muted-foreground">({p.kind})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={`ej-model-${i}`} className="sr-only">
                  Model {i + 1}
                </Label>
                <Input
                  id={`ej-model-${i}`}
                  value={j.model}
                  onChange={(e) => setJudge(i, { model: e.target.value })}
                  placeholder="model name (e.g. claude-opus-4-7)"
                  disabled={disabled || pending}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeJudge(i)}
                disabled={disabled || pending || judges.length <= 1}
                title="Remove this judge"
                className="h-9 w-9 p-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addJudge}
              disabled={disabled || pending || judges.length >= 8}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add judge
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {completeCount} configured · {completeCount >= 2 ? "ensemble enabled" : "needs ≥2 to enable"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {error && (
              <span className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                {error}
              </span>
            )}
            {success && (
              <span className="text-xs text-green-600">{success}</span>
            )}
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={disabled || pending}
            >
              {pending ? (
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-2 h-3.5 w-3.5" />
              )}
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
