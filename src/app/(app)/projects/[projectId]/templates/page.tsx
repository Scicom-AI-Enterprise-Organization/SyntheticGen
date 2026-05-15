import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TemplatesTable } from "./templates-table";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "templates.read");
  const canWrite = role ? projectRoleAllows(role, "templates.write") : false;

  const templates = await prisma.promptTemplate.findMany({
    where: { projectId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prompt templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mustache-style templates with variables: <code>{"{{persona.name}}"}</code>,{" "}
            <code>{"{{taxonomy.path}}"}</code>, <code>{"{{language.primary}}"}</code>.
            The runtime style guide for formality is auto-prepended.
          </p>
        </div>
        {canWrite && (
          <Button asChild>
            <Link href={`/projects/${projectId}/templates/new`}>
              <Plus className="mr-2 h-4 w-4" />
              New template
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates ({templates.length})</CardTitle>
          <CardDescription>
            <code>system</code> for instructions, <code>user-seed</code> for the user message that
            triggers a single-turn sample.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemplatesTable
            projectId={projectId}
            canWrite={canWrite}
            templates={templates.map((t) => ({
              id: t.id,
              name: t.name,
              kind: t.kind,
              description: t.description,
              version: t.version,
              body: t.body,
              bodyPreview: t.body.slice(0, 200),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
