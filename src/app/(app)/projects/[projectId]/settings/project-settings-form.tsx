"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateProject } from "../../actions";

interface Project {
  id: string;
  name: string;
  description: string | null;
  defaultFormality: string;
}

export function ProjectSettingsForm({
  project,
  disabled,
}: {
  project: Project;
  disabled: boolean;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [defaultFormality, setDefaultFormality] = useState(project.defaultFormality);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    start(async () => {
      const res = await updateProject({
        projectId: project.id,
        name,
        description: description || undefined,
        defaultFormality: defaultFormality as "formal" | "semi-formal" | "colloquial" | "mixed",
      });
      if ("error" in res && res.error) {
        setError(res.error);
      } else {
        setSuccess("Project updated.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Name, description, default formality.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={disabled || pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="default-formality">Default formality</Label>
              <Select value={defaultFormality} onValueChange={setDefaultFormality} disabled={disabled || pending}>
                <SelectTrigger id="default-formality" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="formal">Formal</SelectItem>
                  <SelectItem value="semi-formal">Semi-formal</SelectItem>
                  <SelectItem value="colloquial">Colloquial</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Falls through to LanguageProfile / Persona / Run overrides. Changing this only affects new
                runs that resolve formality from the project default.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={disabled || pending}
            />
          </div>

          {error && (
            <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="text-xs text-green-600" role="status">
              {success}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={disabled || pending}>
              <Save className="mr-2 h-4 w-4" />
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
