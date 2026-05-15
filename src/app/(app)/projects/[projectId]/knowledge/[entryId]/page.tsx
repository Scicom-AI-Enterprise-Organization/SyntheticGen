import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { KnowledgeForm } from "../knowledge-form";

export default async function EditKnowledgeEntryPage({
  params,
}: {
  params: Promise<{ projectId: string; entryId: string }>;
}) {
  const { projectId, entryId } = await params;
  await requireProjectPermission(projectId, "knowledge.write");

  const [entry, taxonomyNodes, providers, crawls] = await Promise.all([
    prisma.knowledgeBaseEntry.findUnique({ where: { id: entryId } }),
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
  if (!entry || entry.projectId !== projectId) notFound();

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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{entry.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Edit knowledge entry</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/knowledge`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to knowledge
          </Link>
        </Button>
      </div>
      <KnowledgeForm
        projectId={projectId}
        taxonomyNodes={taxonomyNodes}
        providers={providers}
        crawls={slimCrawls}
        existing={{
          id: entry.id,
          title: entry.title,
          content: entry.content,
          tags: entry.tags,
          taxonomyNodeIds: entry.taxonomyNodeIds,
          sourceUrl: entry.sourceUrl,
        }}
        card={{
          title: "Entry",
          description:
            "Changes apply to future runs only. Existing conversations keep the snapshot they were generated with.",
        }}
      />
    </div>
  );
}
