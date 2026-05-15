"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteKnowledgeEntry } from "./actions";
import { type ExistingEntry } from "./knowledge-form";

interface Row extends ExistingEntry {
  taxonomyNodeNames: string[];
  createdAt: string;
}

export function KnowledgeTable({
  projectId,
  canWrite,
  entries,
}: {
  projectId: string;
  canWrite: boolean;
  entries: Row[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function onDelete(r: Row) {
    const ok = await confirm({
      title: `Delete entry "${r.title}"?`,
      body: "Runs that previously used this entry stay intact (the trace still references the snapshot); only future runs lose this entry.",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      const res = await deleteKnowledgeEntry(projectId, r.id);
      if ("error" in res && (res as { error?: string }).error) {
        setError((res as { error: string }).error);
      }
    });
  }

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No knowledge entries yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-2">
        {entries.map((e) => (
          <div
            key={e.id}
            className="relative rounded-md border border-border bg-card p-3 transition-colors hover:bg-muted/40"
          >
            <Link
              href={`/projects/${projectId}/knowledge/${e.id}`}
              aria-label={`Open ${e.title}`}
              className="absolute inset-0 z-0 rounded-md"
            />
            <div className="relative z-10 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-sm font-medium">{e.title}</h4>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {e.content}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {e.taxonomyNodeNames.length === 0 ? (
                    <Badge variant="outline" className="text-[10px]">
                      project-wide
                    </Badge>
                  ) : (
                    e.taxonomyNodeNames.map((n) => (
                      <Badge key={n} variant="outline" className="text-[10px]">
                        {n}
                      </Badge>
                    ))
                  )}
                  {e.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      #{t}
                    </Badge>
                  ))}
                  {e.sourceUrl && (
                    <a
                      href={e.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="relative z-10 text-[10px] text-primary hover:underline"
                    >
                      source ↗
                    </a>
                  )}
                </div>
              </div>
              {canWrite && (
                <div className="relative z-10 flex shrink-0 gap-1">
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    aria-label="Edit"
                  >
                    <Link href={`/projects/${projectId}/knowledge/${e.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    onClick={() => onDelete(e)}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
