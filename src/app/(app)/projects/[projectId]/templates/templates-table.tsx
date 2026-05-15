"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteTemplate } from "./actions";

interface T {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  version: number;
  body: string;
  bodyPreview: string;
}

export function TemplatesTable({
  projectId,
  canWrite,
  templates,
}: {
  projectId: string;
  canWrite: boolean;
  templates: T[];
}) {
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function onDelete(t: T) {
    setActionError(null);
    const ok = await confirm({
      title: `Delete template "${t.name}"?`,
      body: "Runs that have already used this template keep their snapshot, but new runs cannot select it.",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteTemplate(projectId, t.id);
      if ("error" in res && (res as { error?: string }).error) {
        setActionError((res as { error: string }).error);
      }
    });
  }

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No templates yet.</p>;
  }

  return (
    <div className="space-y-2">
      {actionError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {actionError}
        </p>
      )}
      {templates.map((t) => (
        <div
          key={t.id}
          className="rounded-md border border-border bg-card p-3 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {t.kind}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  v{t.version}
                </Badge>
              </div>
              {t.description && (
                <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
              )}
            </div>
            {canWrite && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  aria-label="Edit"
                  title="Edit template"
                >
                  <Link href={`/projects/${projectId}/templates/${t.id}`}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  onClick={() => onDelete(t)}
                  aria-label="Delete"
                  title="Delete template"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted/40 p-2 text-[11px] leading-snug text-muted-foreground">
            {t.bodyPreview}
            {t.body.length > t.bodyPreview.length ? "…" : ""}
          </pre>
        </div>
      ))}
    </div>
  );
}
