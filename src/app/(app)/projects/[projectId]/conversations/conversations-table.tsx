"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConversationDrawer } from "./conversation-drawer";

interface Row {
  id: string;
  runId: string | null;
  primaryLanguage: string | null;
  primaryScript: string | null;
  difficulty: string | null;
  turnCount: number;
  tokenCount: number;
  status: string;
  createdAt: string;
  persona: string | null;
  topic: string | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  generated: "secondary",
  accepted: "default",
  rejected: "destructive",
  flagged: "outline",
  annotated: "default",
};

export function ConversationsTable({
  projectId,
  initialFocusId,
  conversations,
}: {
  projectId: string;
  initialFocusId: string | null;
  conversations: Row[];
}) {
  const [focusId, setFocusId] = useState<string | null>(initialFocusId);

  useEffect(() => {
    if (initialFocusId) setFocusId(initialFocusId);
  }, [initialFocusId]);

  if (conversations.length === 0) {
    return <p className="text-sm text-muted-foreground">No conversations yet.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 pr-4 font-medium">Persona</th>
              <th className="py-2 pr-4 font-medium">Topic</th>
              <th className="py-2 pr-4 font-medium">Lang</th>
              <th className="py-2 pr-4 font-medium">Turns</th>
              <th className="py-2 pr-4 font-medium">Tokens</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pl-4" />
            </tr>
          </thead>
          <tbody>
            {conversations.map((c) => (
              <tr key={c.id} className="border-b border-border/50 align-top">
                <td className="py-3 pr-4 text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString()}
                </td>
                <td className="py-3 pr-4 text-xs">{c.persona ?? "—"}</td>
                <td className="py-3 pr-4 text-xs">{c.topic ?? "—"}</td>
                <td className="py-3 pr-4 text-xs">
                  {c.primaryLanguage ?? "—"}
                  {c.primaryScript && (
                    <span className="ml-1 text-muted-foreground">/{c.primaryScript}</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-xs">{c.turnCount}</td>
                <td className="py-3 pr-4 text-xs">{c.tokenCount}</td>
                <td className="py-3 pr-4">
                  <Badge variant={STATUS_VARIANT[c.status] ?? "outline"} className="text-[10px]">
                    {c.status}
                  </Badge>
                </td>
                <td className="py-3 pl-4 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setFocusId(c.id)}
                    aria-label="View conversation"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {focusId && (
        <ConversationDrawer
          projectId={projectId}
          conversationId={focusId}
          onClose={() => setFocusId(null)}
        />
      )}
    </>
  );
}
