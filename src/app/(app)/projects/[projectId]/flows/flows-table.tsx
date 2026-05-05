"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteFlow } from "./actions";

interface Flow {
  id: string;
  name: string;
  description: string | null;
  version: number;
  isPublished: boolean;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
}

export function FlowsTable({
  projectId,
  canWrite,
  flows,
}: {
  projectId: string;
  canWrite: boolean;
  flows: Flow[];
}) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  async function onDelete(f: Flow) {
    const ok = await confirm({
      title: `Delete flow "${f.name}"?`,
      body: "All nodes and edges are removed. This cannot be undone.",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteFlow(projectId, f.id);
      if ("error" in res && (res as { error?: string }).error)
        toast.error((res as { error: string }).error);
      else toast.success("Flow deleted");
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Graph</th>
            <th className="py-2 pr-4 font-medium">Updated</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pl-4" />
          </tr>
        </thead>
        <tbody>
          {flows.map((f) => (
            <tr key={f.id} className="border-b border-border/50">
              <td className="py-3 pr-4">
                <Link
                  href={`/projects/${projectId}/flows/${f.id}`}
                  className="font-medium hover:underline"
                >
                  {f.name}
                </Link>
                {f.description && (
                  <div className="text-xs text-muted-foreground">{f.description}</div>
                )}
              </td>
              <td className="py-3 pr-4 text-xs text-muted-foreground">
                {f.nodeCount} node{f.nodeCount === 1 ? "" : "s"} · {f.edgeCount} edge
                {f.edgeCount === 1 ? "" : "s"} · v{f.version}
              </td>
              <td className="py-3 pr-4 text-xs text-muted-foreground">
                {new Date(f.updatedAt).toLocaleString()}
              </td>
              <td className="py-3 pr-4">
                <Badge variant={f.isPublished ? "default" : "outline"} className="text-[10px]">
                  {f.isPublished ? "published" : "draft"}
                </Badge>
              </td>
              <td className="py-3 pl-4 text-right">
                {canWrite && (
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="icon" aria-label="Edit">
                      <Link href={`/projects/${projectId}/flows/${f.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => onDelete(f)}
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
  );
}
