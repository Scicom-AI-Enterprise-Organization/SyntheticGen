"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteProvider } from "./actions";

interface P {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  keyFingerprint: string;
  defaultModel: string | null;
  reasoningEffort: string | null;
  chatTemplateKwargs: Record<string, unknown> | null;
}

export function ProvidersTable({
  projectId,
  canWrite,
  providers,
}: {
  projectId: string;
  canWrite: boolean;
  providers: P[];
}) {
  const [pending, start] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function onDelete(p: P) {
    const ok = await confirm({
      title: `Delete provider "${p.name}"?`,
      body: "The encrypted API key is removed. Runs already pinned to this provider will fail to start.",
      destructive: true,
    });
    if (!ok) return;
    setDeleteError(null);
    start(async () => {
      const res = await deleteProvider(projectId, p.id);
      if ("error" in res && (res as { error?: string }).error) {
        setDeleteError((res as { error: string }).error);
      }
    });
  }

  if (providers.length === 0) {
    return <p className="text-sm text-muted-foreground">No providers configured.</p>;
  }

  return (
    <div className="space-y-3">
      {deleteError && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {deleteError}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Kind</th>
              <th className="py-2 pr-4 font-medium">Base URL</th>
              <th className="py-2 pr-4 font-medium">API key</th>
              <th className="py-2 pr-4 font-medium">Default model</th>
              <th className="py-2 pr-4 font-medium">Reasoning</th>
              <th className="py-2 pl-4" />
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className="border-b border-border/50">
                <td className="py-3 pr-4 font-medium">{p.name}</td>
                <td className="py-3 pr-4">
                  <Badge variant="outline" className="text-[10px]">
                    {p.kind}
                  </Badge>
                </td>
                <td className="py-3 pr-4 font-mono text-xs">{p.baseUrl}</td>
                <td className="py-3 pr-4 font-mono text-xs">{p.keyFingerprint}</td>
                <td className="py-3 pr-4 font-mono text-xs">{p.defaultModel ?? "—"}</td>
                <td className="py-3 pr-4">
                  <div className="flex flex-wrap gap-1">
                    {p.reasoningEffort && (
                      <Badge variant="outline" className="text-[10px]">
                        effort: {p.reasoningEffort}
                      </Badge>
                    )}
                    {p.chatTemplateKwargs &&
                      Object.entries(p.chatTemplateKwargs).map(([k, v]) => (
                        <Badge key={k} variant="outline" className="text-[10px]">
                          {k}: {JSON.stringify(v)}
                        </Badge>
                      ))}
                    {!p.reasoningEffort &&
                      (!p.chatTemplateKwargs ||
                        Object.keys(p.chatTemplateKwargs).length === 0) && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                  </div>
                </td>
                <td className="py-3 pl-4 text-right">
                  {canWrite && (
                    <div className="flex justify-end gap-1">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        aria-label="Edit"
                      >
                        <Link href={`/projects/${projectId}/providers/${p.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        onClick={() => onDelete(p)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
