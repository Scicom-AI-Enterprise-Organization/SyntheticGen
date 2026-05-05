"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FlaskConical, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildDatasetExport } from "../actions";

interface VersionExport {
  id: string;
  format: string;
  status: string;
  storagePath: string;
  rowCount: number | null;
  byteSize: number | null;
  createdAt: string;
}

interface Version {
  id: string;
  version: string;
  description: string | null;
  frozenAt: string;
  frozenBy: string;
  conversationCount: number;
  exports: VersionExport[];
}

export function VersionsList({
  projectId,
  currentVersionId,
  canExport,
  versions,
}: {
  projectId: string;
  currentVersionId: string | null;
  canExport: boolean;
  versions: Version[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function build(versionId: string, format: "openai-jsonl" | "function-call-bench") {
    start(async () => {
      const res = await buildDatasetExport({ projectId, versionId, format });
      if ("error" in res && res.error) toast.error(res.error);
      else if (res.ok) {
        toast.success(
          format === "function-call-bench" ? "Benchmark JSONL built" : "Export built",
        );
        router.refresh();
      }
    });
  }

  return (
    <ul className="space-y-3">
      {versions.map((v) => (
        <li key={v.id} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                <span className="font-mono font-semibold">v{v.version}</span>
                {v.id === currentVersionId && (
                  <Badge variant="default" className="text-[10px]">
                    current
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {v.conversationCount} conversation{v.conversationCount === 1 ? "" : "s"} · frozen{" "}
                {new Date(v.frozenAt).toLocaleString()} by {v.frozenBy}
              </div>
              {v.description && (
                <div className="mt-1 text-xs">{v.description}</div>
              )}
            </div>
            {canExport && (
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => build(v.id, "openai-jsonl")}
                >
                  <Download className="mr-2 h-4 w-4" />
                  OpenAI JSONL
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => build(v.id, "function-call-bench")}
                  title="Scicom Function-Call benchmark format (HF dataset rows with stringified conversation + functions)"
                >
                  <FlaskConical className="mr-2 h-4 w-4" />
                  Function-call bench
                </Button>
              </div>
            )}
          </div>

          {v.exports.length > 0 && (
            <div className="mt-3 space-y-1 text-xs">
              {v.exports.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5 font-mono"
                >
                  <span className="truncate">{e.format}: {e.storagePath}</span>
                  <span className="ml-3 shrink-0 text-muted-foreground">
                    {e.status === "ready"
                      ? `${e.rowCount} rows · ${(e.byteSize ?? 0).toLocaleString()} B`
                      : e.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
