"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  const confirm = useConfirm();

  async function onClick() {
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
        toast.error((res as { error: string }).error);
        return;
      }
      toast.success("Benchmark deleted");
      router.push(`/projects/${projectId}/benchmarks`);
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={onClick}>
      <Trash2 className="mr-2 h-4 w-4" />
      Delete
    </Button>
  );
}
