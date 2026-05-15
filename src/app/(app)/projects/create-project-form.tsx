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
import { createProject } from "./actions";

export function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [formWarning, setFormWarning] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormWarning(null);

    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setFormError("Name must be at least 2 characters");
      return;
    }
    if (trimmed.length > 120) {
      setFormError("Name must be at most 120 characters");
      return;
    }
    if (description.length > 500) {
      setFormError("Description must be at most 500 characters");
      return;
    }

    start(async () => {
      const res = await createProject({ name: trimmed, description });
      if ("error" in res && res.error) {
        setFormError(res.error);
        return;
      }
      if (res.ok) {
        if (res.bootstrapWarning) {
          setFormWarning(res.bootstrapWarning);
        }
        router.push(`/projects/${res.id}`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create project</CardTitle>
          <CardDescription>
            You become the OWNER. Two LanguageProfile presets are seeded automatically —
            edit them, clone them, or replace with profiles tuned for your locale.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="proj-name">Name</Label>
              <Input
                id="proj-name"
                placeholder="Customer Support — Enterprise Formal"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proj-desc">Description (optional)</Label>
              <Input
                id="proj-desc"
                placeholder="Single-line summary"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {formError && (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          )}
          {formWarning && (
            <p className="text-sm text-yellow-600 dark:text-yellow-500" role="status">
              {formWarning}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Plus className="mr-2 h-4 w-4" />
          {pending ? "Creating…" : "Create project"}
        </Button>
      </div>
    </form>
  );
}
