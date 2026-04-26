"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: string;
  content: string | null;
  ordinal: number;
  language: string | null;
  tokenCount: number | null;
  model: string | null;
}

interface Validation {
  id: string;
  validatorKind: string;
  axis: string;
  verdict: string;
  score: number | null;
  details: Record<string, unknown> | null;
}

interface DrawerData {
  id: string;
  status: string;
  primaryLanguage: string | null;
  difficulty: string | null;
  persona: string | null;
  topic: string | null;
  messages: Message[];
  validations: Validation[];
}

const VERDICT_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pass: "default",
  warn: "secondary",
  fail: "destructive",
};

export function ConversationDrawer({
  projectId,
  conversationId,
  onClose,
}: {
  projectId: string;
  conversationId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<DrawerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/conversations/${conversationId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`http ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, conversationId]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40"
        role="button"
        aria-label="Close"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Conversation</div>
            <div className="truncate font-mono text-xs">{conversationId}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          {loading && <p className="text-muted-foreground">Loading…</p>}
          {error && <p className="text-destructive">Failed: {error}</p>}
          {data && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">status: {data.status}</Badge>
                {data.primaryLanguage && <Badge variant="outline">{data.primaryLanguage}</Badge>}
                {data.difficulty && <Badge variant="outline">{data.difficulty}</Badge>}
                {data.persona && <Badge variant="outline">{data.persona}</Badge>}
                {data.topic && <Badge variant="outline">{data.topic}</Badge>}
              </div>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Validations
                </h3>
                <div className="space-y-1">
                  {data.validations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">None.</p>
                  ) : (
                    data.validations.map((v) => (
                      <div
                        key={v.id}
                        className="rounded-md border border-border bg-card p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono">{v.validatorKind}</span>
                          <span className="text-muted-foreground">{v.axis}</span>
                          <Badge variant={VERDICT_VARIANT[v.verdict] ?? "outline"} className="text-[10px]">
                            {v.verdict}
                          </Badge>
                        </div>
                        {v.details && (
                          <pre className="mt-1 overflow-x-auto text-[10px] text-muted-foreground">
                            {JSON.stringify(v.details)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Messages
                </h3>
                <div className="space-y-2">
                  {data.messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "rounded-md border p-2 text-xs",
                        m.role === "system"
                          ? "border-amber-500/30 bg-amber-500/5"
                          : m.role === "user"
                            ? "border-blue-500/30 bg-blue-500/5"
                            : m.role === "assistant"
                              ? "border-emerald-500/30 bg-emerald-500/5"
                              : "border-border",
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-mono uppercase">{m.role}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {m.language ?? "—"}
                          {m.tokenCount != null && ` · ${m.tokenCount} tok`}
                          {m.model && ` · ${m.model}`}
                        </span>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-xs leading-snug">
                        {m.content ?? ""}
                      </pre>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
