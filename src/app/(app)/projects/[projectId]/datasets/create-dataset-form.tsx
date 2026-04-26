"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDataset } from "./actions";

export function CreateDatasetForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createDataset({ projectId, name, description: description || null });
      if ("error" in res && res.error) toast.error(res.error);
      else if (res.ok) {
        toast.success("Dataset created");
        router.push(`/projects/${projectId}/datasets/${res.id}`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input
        placeholder="TM Customer Support v1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Input
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Button type="submit" disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        Create
      </Button>
    </form>
  );
}
