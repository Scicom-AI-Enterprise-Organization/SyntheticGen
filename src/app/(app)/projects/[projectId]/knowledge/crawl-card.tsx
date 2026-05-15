"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Globe } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CrawlDialog, type CrawlPreset } from "./crawl-dialog";
import { CrawlsList } from "./crawls-list";

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
  pages: {
    url: string;
    depth: number;
    title: string;
    content: string;
    contentChars: number;
    truncated?: boolean;
    bytes?: number;
  }[];
}

function parsePreset(sp: URLSearchParams): CrawlPreset | null {
  if (sp.get("crawl") !== "new") return null;
  const startUrl = sp.get("url") ?? "";
  const depth = Number(sp.get("depth") ?? "1");
  const maxPages = Number(sp.get("maxPages") ?? "15");
  const sameOriginOnly = sp.get("sameOrigin") !== "0";
  return {
    startUrl,
    depth: Number.isFinite(depth) ? depth : 1,
    maxPages: Number.isFinite(maxPages) ? maxPages : 15,
    sameOriginOnly,
  };
}

export function CrawlCard({
  projectId,
  canWrite,
  crawls,
}: {
  projectId: string;
  canWrite: boolean;
  crawls: Crawl[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sp = new URLSearchParams(Array.from(searchParams.entries()));
  const preset = parsePreset(sp);
  const open = preset !== null;

  const setOpen = useCallback(
    (next: boolean) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (next) {
        params.set("crawl", "new");
      } else {
        params.delete("crawl");
        params.delete("url");
        params.delete("depth");
        params.delete("maxPages");
        params.delete("sameOrigin");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  function openFresh() {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("crawl", "new");
    params.delete("url");
    params.delete("depth");
    params.delete("maxPages");
    params.delete("sameOrigin");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function openWithPreset(p: CrawlPreset) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("crawl", "new");
    params.set("url", p.startUrl);
    params.set("depth", String(p.depth));
    params.set("maxPages", String(p.maxPages));
    params.set("sameOrigin", p.sameOriginOnly ? "1" : "0");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              URL crawls ({crawls.length})
            </CardTitle>
            <CardDescription>
              Cached page extractions. Expand a crawl to import pages as KB entries,
              re-crawl with the same params, or delete the cache.
            </CardDescription>
          </div>
          {canWrite && (
            <Button type="button" variant="outline" onClick={openFresh}>
              <Globe className="mr-2 h-4 w-4" />
              Crawl a URL
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CrawlsList
          projectId={projectId}
          canWrite={canWrite}
          crawls={crawls}
          onRecrawl={openWithPreset}
        />
      </CardContent>

      {canWrite && (
        <CrawlDialog
          projectId={projectId}
          open={open}
          onOpenChange={setOpen}
          preset={preset ?? undefined}
          trigger={false}
          onDone={() => router.refresh()}
        />
      )}
    </Card>
  );
}
