import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { FullPageConversation } from "./full-page-conversation";

export default async function ConversationFullPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; conversationId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { projectId, conversationId } = await params;
  const sp = await searchParams;
  await requireProjectPermission(projectId, "conversations.read");

  // Confirm the conversation belongs to this project before rendering — the
  // drawer fetches via the API, but we 404 early to avoid leaking the
  // existence of conversations in other projects.
  const exists = await prisma.conversation.findFirst({
    where: { id: conversationId, projectId },
    select: { id: true },
  });
  if (!exists) notFound();

  const initialTab = sp.tab === "trace" ? "trace" : "messages";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/conversations?focus=${conversationId}`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to conversations
          </Link>
        </Button>
      </div>
      <FullPageConversation
        projectId={projectId}
        conversationId={conversationId}
        initialTab={initialTab}
      />
    </div>
  );
}
