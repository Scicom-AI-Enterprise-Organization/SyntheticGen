import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProjectSettingsForm } from "./project-settings-form";
import { ArchiveAndReseed } from "./archive-reseed";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "project.read");
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  const canEdit = role === "OWNER";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Project metadata and danger-zone actions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Name, description, default formality.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectSettingsForm project={project} disabled={!canEdit} />
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Maintenance</CardTitle>
            <CardDescription>
              Reseed default language profiles or archive the project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ArchiveAndReseed projectId={projectId} archived={!!project.archivedAt} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
