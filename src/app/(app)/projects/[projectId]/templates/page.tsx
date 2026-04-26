import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TemplateForm } from "./template-form";
import { TemplatesTable } from "./templates-table";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "templates.read");
  const canWrite = role ? projectRoleAllows(role, "templates.write") : false;

  const [templates, providers] = await Promise.all([
    prisma.promptTemplate.findMany({
      where: { projectId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultModel: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Prompt templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mustache-style templates with variables: <code>{"{{persona.name}}"}</code>,{" "}
          <code>{"{{taxonomy.path}}"}</code>, <code>{"{{language.primary}}"}</code>,{" "}
          <code>{"{{difficulty}}"}</code>. The runtime style guide for formality is auto-prepended.
        </p>
      </div>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>New template</CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateForm projectId={projectId} providers={providers} />
          </CardContent>
        </Card>
      )}

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
              bodyPreview: t.body.slice(0, 200),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
