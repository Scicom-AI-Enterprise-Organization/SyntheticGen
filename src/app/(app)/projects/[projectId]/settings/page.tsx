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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Project metadata and danger-zone actions.
        </p>
      </div>

      <ProjectSettingsForm project={project} disabled={!canEdit} />

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
