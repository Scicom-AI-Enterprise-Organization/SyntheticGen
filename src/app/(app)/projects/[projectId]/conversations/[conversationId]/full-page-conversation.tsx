"use client";

import { useRouter } from "next/navigation";
import { ConversationDrawer } from "../conversation-drawer";

export function FullPageConversation({
  projectId,
  conversationId,
  initialTab,
}: {
  projectId: string;
  conversationId: string;
  initialTab: "messages" | "trace";
}) {
  const router = useRouter();
  return (
    <ConversationDrawer
      projectId={projectId}
      conversationId={conversationId}
      initialTab={initialTab}
      fullPage
      onClose={() => router.push(`/projects/${projectId}/conversations`)}
    />
  );
}
