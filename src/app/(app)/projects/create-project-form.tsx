"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProject } from "./actions";

export function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createProject({ name, description });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      if (res.ok) {
        toast.success("Project created");
        if (res.bootstrapWarning) {
          toast.warning(res.bootstrapWarning);
        }
        router.push(`/projects/${res.id}`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="proj-name">Name</Label>
          <Input
            id="proj-name"
            placeholder="TM Customer Support — Bahasa Baku"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="proj-desc">Description (optional)</Label>
          <Input
            id="proj-desc"
            placeholder="Single-line summary"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        {pending ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}
