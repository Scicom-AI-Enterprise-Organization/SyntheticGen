"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<CrawlPreset | undefined>(undefined);

  function openFresh() {
    setPreset({ startUrl: "", depth: 1, maxPages: 15, sameOriginOnly: true });
    setOpen(true);
  }

  function openWithPreset(p: CrawlPreset) {
    setPreset(p);
    setOpen(true);
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
          preset={preset}
          trigger={false}
          onDone={() => router.refresh()}
        />
      )}
    </Card>
  );
}
