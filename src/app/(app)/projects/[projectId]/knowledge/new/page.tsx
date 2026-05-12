import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KnowledgeForm } from "../knowledge-form";

export default async function NewKnowledgeEntryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "knowledge.write");

  const [taxonomyNodes, providers, crawls] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where: { taxonomy: { projectId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultModel: true },
    }),
    prisma.knowledgeCrawl.findMany({
      where: { projectId },
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
  ]);

  const slimCrawls = crawls.map((c) => ({
    id: c.id,
    startUrl: c.startUrl,
    depth: c.depth,
    maxPages: c.maxPages,
    sameOriginOnly: c.sameOriginOnly,
    status: c.status,
    pagesCount: c.pagesCount,
    errorMessage: c.errorMessage,
    startedAt: c.startedAt.toISOString(),
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    pages: Array.isArray(c.pages)
      ? (c.pages as unknown as {
          url: string;
          depth: number;
          title: string;
          content: string;
          contentChars: number;
          truncated?: boolean;
          bytes?: number;
        }[])
      : [],
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">New knowledge entry</h1>
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${projectId}/knowledge`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to knowledge
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Entry</CardTitle>
          <CardDescription>
            Leave taxonomy links empty for a project-wide entry. Otherwise, the
            entry is only injected when a run targets one of the linked nodes.
            Fill the content from a doc upload OR from a cached crawl.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KnowledgeForm
            projectId={projectId}
            taxonomyNodes={taxonomyNodes}
            providers={providers}
            crawls={slimCrawls}
          />
        </CardContent>
      </Card>
    </div>
  );
}
