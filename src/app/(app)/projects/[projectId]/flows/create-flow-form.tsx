"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createFlow } from "./actions";

export function CreateFlowForm({
  projectId,
  card,
}: {
  projectId: string;
  card?: { title: string; description?: string };
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    start(async () => {
      const res = await createFlow({
        projectId,
        name: name.trim(),
        description: description.trim() || null,
      });
      if ("error" in res && res.error) {
        setError(res.error);
      } else if (res.ok) {
        router.push(`/projects/${projectId}/flows/${res.id}`);
      }
    });
  }

  const fields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="flow-name">Name</Label>
        <Input
          id="flow-name"
          placeholder="TM Modem Outage Triage"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="flow-desc">Description (optional)</Label>
        <Input
          id="flow-desc"
          placeholder="Single-line summary"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </div>
  );

  const errorBlock = error && (
    <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
      {error}
    </p>
  );
  const submitButton = (
    <Button type="submit" disabled={pending}>
      <Plus className="mr-2 h-4 w-4" />
      {pending ? "Creating…" : "Create flow"}
    </Button>
  );

  if (card) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{card.title}</CardTitle>
            {card.description && (
              <CardDescription>{card.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {fields}
            {errorBlock}
          </CardContent>
        </Card>
        <div className="flex justify-end">{submitButton}</div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="TM Modem Outage Triage"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {submitButton}
      </div>
      {errorBlock}
    </form>
  );
}
