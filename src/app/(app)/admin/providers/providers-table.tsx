"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteGlobalProvider } from "./actions";

interface Row {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  keyFingerprint: string;
  defaultModel: string | null;
  reasoningEffort: string | null;
  importCount: number;
}

export function GlobalProvidersTable({ providers }: { providers: Row[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function onDelete(p: Row) {
    const ok = await confirm({
      title: `Delete "${p.name}"?`,
      body:
        p.importCount > 0
          ? `Project copies that imported from this global (${p.importCount}) keep their data — they'll just lose the "imported from" link.`
          : "The global template is removed. No project copies exist.",
      destructive: true,
      confirmText: "Delete provider",
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      const res = await deleteGlobalProvider(p.id);
      if ("error" in res && (res as { error?: string }).error) {
        setError((res as { error: string }).error);
      }
    });
  }

  if (providers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No global providers yet. Click <strong>New provider</strong> to add one.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
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
              <th className="py-2 pr-4 font-medium">Imports</th>
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
                <td className="py-3 pr-4 text-xs">
                  {p.reasoningEffort ? (
                    <Badge variant="outline" className="text-[10px]">
                      {p.reasoningEffort}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-xs">
                  <Badge variant="secondary" className="text-[10px]">
                    {p.importCount}
                  </Badge>
                </td>
                <td className="py-3 pl-4 text-right">
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="icon" aria-label="Edit">
                      <Link href={`/admin/providers/${p.id}`}>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
