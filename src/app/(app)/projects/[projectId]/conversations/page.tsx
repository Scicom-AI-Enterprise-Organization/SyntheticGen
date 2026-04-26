import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConversationsTable } from "./conversations-table";

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ runId?: string; focus?: string; status?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  await requireProjectPermission(projectId, "conversations.read");

  const where = {
    projectId,
    ...(sp.runId ? { runId: sp.runId } : {}),
    ...(sp.status ? { status: sp.status } : {}),
  };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
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
  });

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
          <CardTitle>{conversations.length} conversation{conversations.length === 1 ? "" : "s"}</CardTitle>
          <CardDescription>Last 100 (filter by status / run via URL).</CardDescription>
        </CardHeader>
        <CardContent>
          <ConversationsTable
            projectId={projectId}
            initialFocusId={sp.focus ?? null}
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
