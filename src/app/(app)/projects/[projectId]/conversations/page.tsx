import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConversationsTable, type SortField, type SortDir } from "./conversations-table";

const PAGE_SIZE = 25;
const SORT_FIELDS: readonly SortField[] = ["createdAt", "turnCount", "tokenCount"];

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    runId?: string;
    focus?: string;
    tab?: string;
    status?: string;
    topic?: string;
    lang?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { role } = await requireProjectPermission(projectId, "conversations.read");
  const canDelete = role ? projectRoleAllows(role, "conversations.annotate") : false;

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const sort: SortField = SORT_FIELDS.includes(sp.sort as SortField)
    ? (sp.sort as SortField)
    : "createdAt";
  const dir: SortDir = sp.dir === "asc" ? "asc" : "desc";

  const where: Prisma.ConversationWhereInput = {
    projectId,
    ...(sp.runId ? { runId: sp.runId } : {}),
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.topic ? { taxonomyNodeId: sp.topic } : {}),
    ...(sp.lang ? { primaryLanguage: sp.lang } : {}),
  };

  const [conversations, totalCount, taxonomyNodes, distinctLanguages] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { [sort]: dir },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        runId: true,
        primaryLanguage: true,
        primaryScript: true,
        difficulty: true,
        turnCount: true,
        tokenCount: true,
        status: true,
        createdAt: true,
        persona: { select: { name: true } },
        taxonomyNode: { select: { name: true, path: true } },
      },
    }),
    prisma.conversation.count({ where }),
    prisma.taxonomyNode.findMany({
      where: { taxonomy: { projectId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.conversation.findMany({
      where: { projectId },
      distinct: ["primaryLanguage"],
      orderBy: { primaryLanguage: "asc" },
      select: { primaryLanguage: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const languages = distinctLanguages
    .map((d) => d.primaryLanguage)
    .filter((l): l is string => Boolean(l));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Conversations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generated samples. Click a row to inspect the full transcript and validation verdicts.
          {sp.runId && (
            <>
              {" "}Filtered by run <code className="font-mono text-xs">{sp.runId}</code>.
            </>
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {totalCount} conversation{totalCount === 1 ? "" : "s"}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              page {page} of {totalPages}
            </span>
          </CardTitle>
          <CardDescription>
            Filter by topic / language / status, sort by turns / tokens / time. State is preserved
            in the URL.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConversationsTable
            projectId={projectId}
            initialFocusId={sp.focus ?? null}
            initialTab={sp.tab === "trace" ? "trace" : "messages"}
            canDelete={canDelete}
            taxonomyNodes={taxonomyNodes}
            languages={languages}
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={PAGE_SIZE}
            sort={sort}
            dir={dir}
            filters={{
              topic: sp.topic ?? null,
              lang: sp.lang ?? null,
              status: sp.status ?? null,
            }}
            conversations={conversations.map((c) => ({
              id: c.id,
              runId: c.runId,
              primaryLanguage: c.primaryLanguage,
              primaryScript: c.primaryScript,
              difficulty: c.difficulty,
              turnCount: c.turnCount,
              tokenCount: c.tokenCount,
              status: c.status,
              createdAt: c.createdAt.toISOString(),
              persona: c.persona?.name ?? null,
              topic: c.taxonomyNode?.name ?? null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
