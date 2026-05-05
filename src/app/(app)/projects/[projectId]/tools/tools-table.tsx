"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteToolDef } from "./actions";

interface Tool {
  id: string;
  name: string;
  description: string;
  version: number;
  localePresets: string[];
  parameters: unknown;
}

export function ToolsTable({
  projectId,
  canWrite,
  tools,
}: {
  projectId: string;
  canWrite: boolean;
  tools: Tool[];
}) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  async function onDelete(t: Tool) {
    const ok = await confirm({
      title: `Delete tool "${t.name}"?`,
      body: "Future flow runs that reference this tool by name will fall back to a stub schema.",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteToolDef(projectId, t.id);
      if ("error" in res && (res as { error?: string }).error)
        toast.error((res as { error: string }).error);
      else toast.success("Tool deleted");
    });
  }

  if (tools.length === 0) {
    return <p className="text-sm text-muted-foreground">No tools yet.</p>;
  }

  return (
    <div className="space-y-2">
      {tools.map((t) => {
        let preview = "";
        try {
          preview = JSON.stringify(t.parameters, null, 2);
        } catch {
          preview = String(t.parameters);
        }
        return (
          <div key={t.id} className="rounded-md border border-border bg-card p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{t.name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    v{t.version}
                  </Badge>
                  {t.localePresets.map((p) => (
                    <Badge key={p} variant="outline" className="text-[10px]">
                      {p}
                    </Badge>
                  ))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{t.description}</div>
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
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                parameters
              </summary>
              <pre className="mt-1 overflow-x-auto rounded-md bg-muted/40 p-2 text-[11px] leading-snug">
                {preview}
              </pre>
            </details>
          </div>
        );
      })}
    </div>
  );
}
