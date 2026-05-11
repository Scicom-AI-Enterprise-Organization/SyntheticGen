"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createFlow } from "./actions";

export function CreateFlowForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createFlow({
        projectId,
        name,
        description: description || null,
      });
      if ("error" in res && res.error) {
        setError(res.error);
      } else if (res.ok) {
        // Navigation itself is the success signal — no toast.
        router.push(`/projects/${projectId}/flows/${res.id}`);
      }
    });
  }

  return (
    <div className="space-y-2">
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          placeholder="TM Modem Outage Triage"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="submit" disabled={pending}>
          <Plus className="mr-2 h-4 w-4" />
          {pending ? "Creating…" : "Create"}
        </Button>
      </form>
      {error && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
