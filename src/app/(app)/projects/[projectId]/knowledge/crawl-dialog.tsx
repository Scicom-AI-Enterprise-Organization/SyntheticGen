"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface CrawledPage {
  url: string;
  depth: number;
  title: string;
  content: string;
  contentChars: number;
  truncated: boolean;
}

interface ProgressLine {
  kind: "fetching" | "skipped" | "error";
  url?: string;
  reason?: string;
  error?: string;
  depth?: number;
}

export interface CrawlPreset {
  startUrl?: string;
  depth?: number;
  maxPages?: number;
  sameOriginOnly?: boolean;
}

// The dialog only crawls + caches. Importing the cached pages into a single
// knowledge-base entry happens from the New entry form ("Import crawled pages"),
// so the dialog has no tag / taxonomy / save UI of its own.
export function CrawlDialog({
  projectId,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  preset,
  trigger = true,
  onDone,
}: {
  projectId: string;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  preset?: CrawlPreset;
  trigger?: boolean;
  onDone?: () => void;
}) {
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? Boolean(openProp) : openInternal;
  const setOpen = (next: boolean) => {
    if (!isControlled) setOpenInternal(next);
    onOpenChangeProp?.(next);
  };
  const [startUrl, setStartUrl] = useState(preset?.startUrl ?? "");
  const [depth, setDepth] = useState(preset?.depth ?? 1);
  const [maxPages, setMaxPages] = useState(preset?.maxPages ?? 15);
  const [sameOriginOnly, setSameOriginOnly] = useState(preset?.sameOriginOnly ?? true);
  useEffectOnPreset(preset, open, (p) => {
    if (p.startUrl !== undefined) setStartUrl(p.startUrl);
    if (p.depth !== undefined) setDepth(p.depth);
    if (p.maxPages !== undefined) setMaxPages(p.maxPages);
    if (p.sameOriginOnly !== undefined) setSameOriginOnly(p.sameOriginOnly);
  });

  const [crawling, setCrawling] = useState(false);
  const [pages, setPages] = useState<CrawledPage[]>([]);
  const [progress, setProgress] = useState<ProgressLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function reset() {
    setPages([]);
    setProgress([]);
    setError(null);
    setDone(false);
  }

  function onClose() {
    if (crawling) return;
    setOpen(false);
    setStartUrl("");
    reset();
  }

  async function onCrawl() {
    if (!startUrl.trim()) {
      setError("Enter a URL to crawl.");
      return;
    }
    reset();
    setCrawling(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/crawl`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startUrl, depth, maxPages, sameOriginOnly }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `http ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(trimmed); } catch { continue; }
          const type = evt.type as string;
          if (type === "page") {
            setPages((prev) => [
              ...prev,
              {
                url: evt.url as string,
                depth: (evt.depth as number) ?? 0,
                title: (evt.title as string) ?? "",
                content: (evt.content as string) ?? "",
                contentChars: (evt.contentChars as number) ?? 0,
                truncated: Boolean(evt.truncated),
              },
            ]);
          } else if (type === "fetching" || type === "skipped" || type === "error") {
            setProgress((prev) => [
              ...prev,
              {
                kind: type as ProgressLine["kind"],
                url: typeof evt.url === "string" ? evt.url : undefined,
                reason: typeof evt.reason === "string" ? evt.reason : undefined,
                error: typeof evt.error === "string" ? evt.error : undefined,
                depth: typeof evt.depth === "number" ? evt.depth : undefined,
              },
            ]);
          } else if (type === "done") {
            setDone(true);
          }
        }
      }
    } catch (e) {
      const err = e as Error;
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setCrawling(false);
      onDone?.();
    }
  }

  function onStop() {
    abortRef.current?.abort();
  }

  return (
    <>
      {trigger && (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <Globe className="mr-2 h-4 w-4" />
          Crawl a URL
        </Button>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : onClose())}>
        <DialogContent className="sm:max-w-3xl overflow-x-hidden [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Crawl a URL
            </DialogTitle>
            <DialogDescription>
              BFS crawl up to <strong>depth N</strong> from the start URL. Pages
              are cached and can be imported as a single KB entry from the{" "}
              <strong>New entry</strong> form.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px]">
            <div className="space-y-1">
              <Label htmlFor="cr-url">Start URL</Label>
              <Input
                id="cr-url"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://example.com/docs"
                disabled={crawling}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cr-depth">Depth</Label>
              <Input
                id="cr-depth"
                type="number"
                min={0}
                max={3}
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                disabled={crawling}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cr-max">Max pages</Label>
              <Input
                id="cr-max"
                type="number"
                min={1}
                max={50}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                disabled={crawling}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-xs">
              <Checkbox
                checked={sameOriginOnly}
                onCheckedChange={(v) => setSameOriginOnly(v === true)}
                disabled={crawling}
              />
              Same-origin only
            </label>
            <span className="text-[11px] text-muted-foreground">
              Crawler ignores robots.txt — point it only at sites you own or have
              permission to scrape.
            </span>
          </div>

          {(crawling || pages.length > 0 || progress.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label>Progress</Label>
                <span className="text-muted-foreground">
                  {pages.length} page{pages.length === 1 ? "" : "s"}
                  {progress.filter((p) => p.kind === "skipped").length > 0 &&
                    ` · ${progress.filter((p) => p.kind === "skipped").length} skipped`}
                  {progress.filter((p) => p.kind === "error").length > 0 &&
                    ` · ${progress.filter((p) => p.kind === "error").length} errors`}
                  {crawling && " · streaming…"}
                  {done && " · cached"}
                </span>
              </div>
              <div className="max-h-64 w-full space-y-1 overflow-auto rounded-md border border-border bg-muted/20 p-2 font-mono text-[11px] [&_*]:min-w-0">
                {pages.length === 0 && progress.length === 0 && (
                  <p className="text-muted-foreground">Waiting for first page…</p>
                )}
                {pages.map((p) => (
                  <div key={p.url} className="flex w-full min-w-0 items-start gap-2 p-1">
                    <Badge variant="outline" className="shrink-0 text-[9px]">
                      d{p.depth}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {p.title || p.url}
                      </span>
                      <span className="block truncate text-muted-foreground">
                        {p.url} ·{" "}
                        <span className="text-[10px]">
                          {p.contentChars} chars
                          {p.truncated && " · truncated"}
                        </span>
                      </span>
                    </span>
                  </div>
                ))}
                {progress
                  .slice(-12)
                  .filter((p) => p.kind !== "fetching" || crawling)
                  .map((p, i) => (
                    <p
                      key={i}
                      className={`block w-full break-all ${
                        p.kind === "error"
                          ? "text-destructive"
                          : p.kind === "skipped"
                            ? "text-muted-foreground"
                            : "text-muted-foreground italic"
                      }`}
                    >
                      {p.kind === "fetching" && (
                        <Loader2 className="inline h-3 w-3 animate-spin" />
                      )}{" "}
                      [{p.kind}] {p.url}
                      {p.reason ? ` — ${p.reason}` : p.error ? ` — ${p.error}` : ""}
                    </p>
                  ))}
              </div>
            </div>
          )}

          {error && (
            <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {done && !error && (
            <p className="text-xs text-green-600">
              Crawl cached. Close this dialog and open <strong>New entry</strong>{" "}
              → <strong>Import crawled pages</strong> to turn it into a KB entry.
            </p>
          )}

          <DialogFooter>
            {crawling ? (
              <Button variant="destructive" onClick={onStop}>
                Stop
              </Button>
            ) : (
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            )}
            <Button onClick={onCrawl} disabled={crawling} variant="secondary">
              {crawling ? "Crawling…" : pages.length > 0 ? "Re-crawl" : "Crawl"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Apply parent-supplied preset whenever the dialog actually opens (so closing
// + reopening picks up the latest re-crawl click). Compare by JSON signature
// to avoid useEffect loops from object-literal props.
function useEffectOnPreset(
  preset: CrawlPreset | undefined,
  open: boolean,
  apply: (p: CrawlPreset) => void,
) {
  const last = useRef<string>("");
  useEffect(() => {
    if (!open || !preset) return;
    const sig = JSON.stringify(preset);
    if (sig === last.current) return;
    last.current = sig;
    apply(preset);
  }, [open, preset, apply]);
}
