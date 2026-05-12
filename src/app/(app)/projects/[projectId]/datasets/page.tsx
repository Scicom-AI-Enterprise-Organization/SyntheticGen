import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateDatasetForm } from "./create-dataset-form";
import { DatasetsList } from "./datasets-list";

export default async function DatasetsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "datasets.read");
  const canFreeze = role ? projectRoleAllows(role, "datasets.freeze") : false;

  const datasets = await prisma.dataset.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { versions: true } },
      currentVersion: { select: { version: true, frozenAt: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Datasets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A dataset is a named collection. Frozen versions are immutable; exports are
          built from a version.
        </p>
      </div>

      {canFreeze && (
        <Card>
          <CardHeader>
            <CardTitle>New dataset</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateDatasetForm projectId={projectId} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datasets ({datasets.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <DatasetsList
            projectId={projectId}
            canWrite={canFreeze}
            datasets={datasets.map((d) => ({
              id: d.id,
              name: d.name,
              description: d.description,
              versionCount: d._count.versions,
              currentVersionLabel: d.currentVersion?.version
                ? `v${d.currentVersion.version}`
                : null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
