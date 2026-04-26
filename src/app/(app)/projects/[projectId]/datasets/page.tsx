import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
    <div className="mx-auto max-w-5xl space-y-6">
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
          {datasets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No datasets yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {datasets.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/projects/${projectId}/datasets/${d.id}`}
                    className="flex items-center justify-between gap-4 rounded-md px-2 py-3 hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.description || "—"} ·{" "}
                        {d._count.versions === 0
                          ? "no versions"
                          : `current: v${d.currentVersion?.version ?? "—"}`}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
