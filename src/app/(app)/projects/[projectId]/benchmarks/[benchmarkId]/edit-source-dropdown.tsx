"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
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
import { editBenchmarkSource } from "../actions";

interface RunOption {
  id: string;
  name: string;
  model: string;
  acceptedCount: number;
}

const ANY_RUN = "__any__";

// Source-run picker + sample-size input. Mirrors the new-benchmark form's
// equivalent fields so users can edit an existing benchmark's source set
// without learning a different UI. Saving re-evaluates the filter and
// updates the benchmark's frozen conversation list.
//
// Past BenchmarkRun rows keep their per-item results — those reference
// specific conversation IDs that may no longer be in the new frozen set,
// so historical runs become snapshots of a stale list, not directly
// comparable to future runs.
export function EditSourceDropdown({
  projectId,
  benchmarkId,
  runs,
  currentRunId,
  currentLimit,
  existingRunCount,
}: {
  projectId: string;
  benchmarkId: string;
  runs: RunOption[];
  currentRunId: string | null;
  currentLimit: number;
  existingRunCount: number;
}) {
  const router = useRouter();
  const [runId, setRunId] = useState<string>(currentRunId ?? ANY_RUN);
  const [limit, setLimit] = useState(String(currentLimit));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const parsedLimit = Number(limit);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 2000) {
      setError("Sample size must be between 1 and 2000");
      return;
    }
    start(async () => {
      const filter: Record<string, unknown> = {
        statuses: ["accepted"],
        limit: parsedLimit,
      };
      if (runId !== ANY_RUN) filter.runIds = [runId];
      const res = await editBenchmarkSource({
        projectId,
        benchmarkId,
        filter: filter as Parameters<typeof editBenchmarkSource>[0]["filter"],
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if ("itemCount" in res) {
        setInfo(`Source updated — ${res.itemCount} conversation(s) frozen.`);
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="es-run">Source run</Label>
          <Select value={runId} onValueChange={setRunId} disabled={pending}>
            <SelectTrigger id="es-run">
              <SelectValue placeholder="Any accepted conversation in project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_RUN}>
                Any accepted conversation in project
              </SelectItem>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name || r.id.slice(-6)} · {r.model} · {r.acceptedCount} accepted
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="es-limit">Sample size (1–2000)</Label>
          <Input
            id="es-limit"
            type="number"
            min={1}
            max={2000}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            disabled={pending}
            required
          />
          <p className="text-[10px] text-muted-foreground">
            Caps how many conversations get frozen into the eval set. Higher =
            slower / more expensive judging.
          </p>
        </div>
      </div>

      {existingRunCount > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
          {existingRunCount} existing benchmark run
          {existingRunCount === 1 ? "" : "s"} reference the current frozen set.
          After saving, those past runs keep their per-item results but their
          conversation IDs may no longer be in the new frozen list — treat them
          as historical snapshots.
        </p>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}
      {info && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
          {info}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          <Save className="mr-2 h-3.5 w-3.5" />
          {pending ? "Saving…" : "Save source"}
        </Button>
      </div>
    </form>
  );
}
