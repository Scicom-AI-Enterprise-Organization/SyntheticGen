"use client";

import { useState, useTransition } from "react";
import { Globe, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { deleteKnowledgeCrawl } from "./actions";

interface CrawlPage {
  url: string;
  depth: number;
  title: string;
  content: string;
  contentChars: number;
  truncated?: boolean;
  bytes?: number;
}

interface Crawl {
  id: string;
  startUrl: string;
  depth: number;
  maxPages: number;
  sameOriginOnly: boolean;
  status: string;
  pagesCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  pages: CrawlPage[];
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  running: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

export function CrawlsList({
  projectId,
  crawls,
  canWrite,
  onRecrawl,
}: {
  projectId: string;
  crawls: Crawl[];
  canWrite: boolean;
  onRecrawl: (params: {
    startUrl: string;
    depth: number;
    maxPages: number;
    sameOriginOnly: boolean;
  }) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onDelete(c: Crawl) {
    const ok = await confirm({
      title: `Delete this crawl cache?`,
      body: `${c.pagesCount} cached page(s) for ${c.startUrl} will be lost. KB entries already imported from this crawl stay.`,
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      const res = await deleteKnowledgeCrawl(projectId, c.id);
      if ("error" in res && (res as { error?: string }).error) {
        setError((res as { error: string }).error);
      } else if (expandedId === c.id) {
        setExpandedId(null);
      }
    });
  }

  if (crawls.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No crawls yet. Click <strong>Crawl a URL</strong> to start one — pages
        are cached here and you can use them as a single entry from the{" "}
        <strong>New entry</strong> form.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {crawls.map((c) => {
        const isExpanded = expandedId === c.id;
        return (
          <div key={c.id} className="rounded-md border border-border bg-card">
            <div className="flex items-start justify-between gap-3 p-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setExpandedId(isExpanded ? null : c.id)}
              >
                <div className="flex items-center gap-2">
                  <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{c.startUrl}</span>
                  <Badge variant={STATUS_VARIANT[c.status] ?? "outline"} className="text-[10px]">
                    {c.status}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span>{c.pagesCount} page{c.pagesCount === 1 ? "" : "s"}</span>
                  <span>depth {c.depth}</span>
                  <span>max {c.maxPages}</span>
                  {c.sameOriginOnly && <span>same-origin</span>}
                  <span>{new Date(c.startedAt).toLocaleString()}</span>
                  {c.errorMessage && (
                    <span className="text-destructive">— {c.errorMessage}</span>
                  )}
                </div>
              </button>
              {canWrite && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Re-crawl with the same params"
                    disabled={pending}
                    onClick={() =>
                      onRecrawl({
                        startUrl: c.startUrl,
                        depth: c.depth,
                        maxPages: c.maxPages,
                        sameOriginOnly: c.sameOriginOnly,
                      })
                    }
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Delete cached crawl"
                    disabled={pending}
                    onClick={() => onDelete(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {isExpanded && c.pages.length > 0 && (
              <div className="max-h-96 space-y-1 overflow-auto border-t border-border bg-muted/20 p-2 font-mono text-[11px]">
                {c.pages.map((p) => (
                  <details
                    key={p.url}
                    className="group rounded border border-transparent hover:border-border"
                  >
                    <summary className="flex cursor-pointer items-start gap-2 p-1 select-none">
                      <Badge variant="outline" className="shrink-0 text-[9px]">
                        d{p.depth}
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium group-open:whitespace-normal">
                          {p.title || p.url}
                        </span>
                        <span className="block truncate text-muted-foreground group-open:whitespace-normal group-open:break-all">
                          {p.url} ·{" "}
                          <span className="text-[10px]">
                            {p.contentChars} chars{p.truncated && " · truncated"}
                          </span>
                        </span>
                      </span>
                    </summary>
                    <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-background/70 px-2 py-1 font-mono text-[10px] leading-snug">
                      {p.content || "(empty)"}
                    </pre>
                  </details>
                ))}
              </div>
            )}
            {isExpanded && c.pages.length === 0 && (
              <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                No pages cached
                {c.status === "running" ? " yet — still in progress." : "."}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
