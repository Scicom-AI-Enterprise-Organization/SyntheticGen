"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ChevronDown, Loader2, Pencil, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { replicateRunAction } from "../actions";

export function ReplicateRunMenu({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onReplicate() {
    setError(null);
    start(async () => {
      try {
        // The server action redirects on success — control returns here
        // only when it errored before the redirect.
        const res = await replicateRunAction(projectId, runId);
        if (res && "error" in res && res.error) setError(res.error);
      } catch (e) {
        // Next throws `NEXT_REDIRECT` on success — that bubbles up here as
        // an error-shaped object. Treat anything else as a real failure.
        const msg = (e as { message?: string })?.message ?? "Replicate failed";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  }

  function onEditAndStart() {
    router.push(`/projects/${projectId}/runs/new?cloneFrom=${runId}`);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending}>
            {pending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Copy className="mr-1 h-3 w-3" />
            )}
            {pending ? "Cloning…" : "Replicate"}
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Clone this run's frozen config
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onReplicate} disabled={pending}>
            <RotateCw className="mr-2 h-3.5 w-3.5" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">Replicate as-is</span>
              <span className="text-[11px] text-muted-foreground">
                Create a new run with identical config + start it
                immediately. Same provider, template, tools, sampling,
                grid — fresh conversations.
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onEditAndStart} disabled={pending}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">Edit & start (pre-fill /runs/new)</span>
              <span className="text-[11px] text-muted-foreground">
                Open the start form with this run's settings filled in,
                so you can tweak anything (tools, turns, sampling) before
                running.
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p className="max-w-[280px] rounded-md border border-destructive/40 bg-destructive/10 p-1.5 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
