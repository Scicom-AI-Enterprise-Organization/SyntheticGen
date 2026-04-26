"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteTemplate } from "./actions";

interface T {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  version: number;
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

  function onDelete(t: T) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    start(async () => {
      const res = await deleteTemplate(projectId, t.id);
      if ("error" in res && (res as { error?: string }).error)
        toast.error((res as { error: string }).error);
      else toast.success("Template deleted");
    });
  }

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No templates yet.</p>;
  }

  return (
    <div className="space-y-2">
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
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => onDelete(t)}
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted/40 p-2 text-[11px] leading-snug text-muted-foreground">
            {t.bodyPreview}
            {t.bodyPreview.length === 200 ? "…" : ""}
          </pre>
        </div>
      ))}
    </div>
  );
}
