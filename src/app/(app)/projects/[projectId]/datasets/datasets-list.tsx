"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteDataset } from "./actions";

interface DatasetRow {
  id: string;
  name: string;
  description: string | null;
  versionCount: number;
  currentVersionLabel: string | null;
}

export function DatasetsList({
  projectId,
  datasets,
  canWrite,
}: {
  projectId: string;
  datasets: DatasetRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onDelete(d: DatasetRow) {
    const ok = await confirm({
      title: `Delete dataset "${d.name}"?`,
      body: `All ${d.versionCount} version(s), their exports and per-version conversation links are removed. The underlying conversations stay intact.`,
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      const res = await deleteDataset(projectId, d.id);
      if ("error" in res && (res as { error?: string }).error) {
        setError((res as { error: string }).error);
      } else {
        router.refresh();
      }
    });
  }

  if (datasets.length === 0) {
    return <p className="text-sm text-muted-foreground">No datasets yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <ul className="divide-y divide-border">
        {datasets.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-2 rounded-md px-2 py-3 hover:bg-muted/40"
          >
            <Link
              href={`/projects/${projectId}/datasets/${d.id}`}
              className="min-w-0 flex-1"
            >
              <div className="font-medium">{d.name}</div>
              <div className="text-xs text-muted-foreground">
                {d.description || "—"} ·{" "}
                {d.versionCount === 0
                  ? "no versions"
                  : `current: ${d.currentVersionLabel ?? "—"}`}
              </div>
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              {canWrite && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  onClick={() => onDelete(d)}
                  aria-label="Delete dataset"
                  title="Delete dataset"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Link
                href={`/projects/${projectId}/datasets/${d.id}`}
                className="rounded-md p-2 hover:bg-muted"
                aria-label="Open dataset"
              >
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
