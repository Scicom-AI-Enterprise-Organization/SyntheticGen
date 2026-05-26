"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Settings, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setBenchmarkDefaultEnsembleGroup } from "../actions";

interface GroupOption {
  id: string;
  name: string;
  judgeCount: number;
}

const NONE = "__none__";

// Per-benchmark default ensemble group. Just a dropdown — when set,
// the run-page ensemble dialog pre-selects this group. Save commits
// the choice via setBenchmarkDefaultEnsembleGroup.
export function DefaultEnsemblePicker({
  projectId,
  benchmarkId,
  groups,
  initialGroupId,
  disabled,
}: {
  projectId: string;
  benchmarkId: string;
  groups: GroupOption[];
  initialGroupId: string | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const [groupId, setGroupId] = useState<string>(initialGroupId ?? NONE);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function onChange(next: string) {
    setGroupId(next);
    setError(null);
    setSuccess(null);
    start(async () => {
      const res = await setBenchmarkDefaultEnsembleGroup({
        projectId,
        benchmarkId,
        groupId: next === NONE ? null : next,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        // Revert visible selection so it matches DB state.
        setGroupId(initialGroupId ?? NONE);
        return;
      }
      setSuccess(next === NONE ? "Cleared." : "Saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="default-ensemble" className="flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Default ensemble group
        </Label>
        <Link
          href={`/projects/${projectId}/benchmarks`}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
        >
          <Settings className="h-3 w-3" />
          Manage groups
        </Link>
      </div>
      <Select value={groupId} onValueChange={onChange} disabled={disabled || pending}>
        <SelectTrigger id="default-ensemble">
          <SelectValue placeholder="(no default — pick at re-judge time)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>(no default — pick at re-judge time)</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g.id} value={g.id} disabled={g.judgeCount < 2}>
              {g.name}
              <span className="ml-1 text-muted-foreground">
                ({g.judgeCount} judge{g.judgeCount === 1 ? "" : "s"}
                {g.judgeCount < 2 && " — needs ≥2"})
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground">
        Auto-selected in the &quot;Re-judge with ensemble&quot; dialog on this
        benchmark&apos;s completed runs. Override per-run if needed.
        {pending && (
          <RefreshCw className="ml-2 inline-block h-3 w-3 animate-spin align-text-bottom" />
        )}
      </p>
      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}
      {success && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
          {success}
        </p>
      )}
    </div>
  );
}
