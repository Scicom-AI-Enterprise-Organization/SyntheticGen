"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteBenchmark } from "../actions";

export function DeleteBenchmarkButton({
  projectId,
  benchmarkId,
}: {
  projectId: string;
  benchmarkId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function onClick() {
    setError(null);
    const ok = await confirm({
      title: "Delete this benchmark?",
      body: "All runs and per-row results are cascade-deleted. The HF dataset itself is not affected.",
      confirmText: "Delete benchmark",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteBenchmark(projectId, benchmarkId);
      if ("error" in res && (res as { error?: string }).error) {
        setError((res as { error: string }).error);
        return;
      }
      router.push(`/projects/${projectId}/benchmarks`);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={onClick}>
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </Button>
      {error && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
