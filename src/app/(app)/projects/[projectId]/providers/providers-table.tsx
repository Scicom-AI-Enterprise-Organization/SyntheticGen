"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteProvider } from "./actions";

interface P {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  keyFingerprint: string;
  defaultModel: string | null;
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

  function onDelete(p: P) {
    if (!confirm(`Delete provider "${p.name}"?`)) return;
    start(async () => {
      const res = await deleteProvider(projectId, p.id);
      if ("error" in res && (res as { error?: string }).error)
        toast.error((res as { error: string }).error);
      else toast.success("Provider deleted");
    });
  }

  if (providers.length === 0) {
    return <p className="text-sm text-muted-foreground">No providers configured.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Kind</th>
            <th className="py-2 pr-4 font-medium">Base URL</th>
            <th className="py-2 pr-4 font-medium">API key</th>
            <th className="py-2 pr-4 font-medium">Default model</th>
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
              <td className="py-3 pl-4 text-right">
                {canWrite && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    onClick={() => onDelete(p)}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
