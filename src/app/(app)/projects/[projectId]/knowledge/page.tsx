import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KnowledgeForm } from "./knowledge-form";
import { KnowledgeTable } from "./knowledge-table";
import { CrawlCard } from "./crawl-card";

export default async function KnowledgePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "knowledge.read");
  const canWrite = role ? projectRoleAllows(role, "knowledge.write") : false;

  const [entries, taxonomyNodes, providers, crawls] = await Promise.all([
    prisma.knowledgeBaseEntry.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    }),
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

  // Pre-compute id → name map so the table can show "linked to: X, Y" cheaply.
  const nodeNameById = Object.fromEntries(taxonomyNodes.map((n) => [n.id, n.name]));

  // Slim crawl shape shared by the New-entry form picker and the URL-crawls card.
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Knowledge base</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Domain facts the assistant should ground its answers in. Each entry can be
          linked to one or more taxonomy nodes; the worker auto-injects matching
          entries into the system prompt before every generation and records which
          entries were used in the conversation trace.
        </p>
      </div>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>New entry</CardTitle>
            <CardDescription>
              Leave taxonomy links empty for a project-wide entry. Otherwise, the
              entry is only injected when a run targets one of the linked nodes.
              Fill the content from a doc upload OR from a cached crawl below.
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
      )}

      <CrawlCard
        projectId={projectId}
        canWrite={canWrite}
        crawls={slimCrawls}
      />

      <Card>
        <CardHeader>
          <CardTitle>Entries ({entries.length})</CardTitle>
          <CardDescription>
            Matched by <code>taxonomyNodeIds</code> against the run&apos;s primary node.
            Entries with an empty node list match every run in the project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KnowledgeTable
            projectId={projectId}
            canWrite={canWrite}
            taxonomyNodes={taxonomyNodes}
            providers={providers}
            entries={entries.map((e) => ({
              id: e.id,
              title: e.title,
              content: e.content,
              tags: e.tags,
              taxonomyNodeIds: e.taxonomyNodeIds,
              taxonomyNodeNames: e.taxonomyNodeIds
                .map((id) => nodeNameById[id])
                .filter((x): x is string => Boolean(x)),
              sourceUrl: e.sourceUrl,
              createdAt: e.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
