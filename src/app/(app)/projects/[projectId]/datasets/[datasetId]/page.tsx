import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FreezeForm } from "./freeze-form";
import { VersionsList } from "./versions-list";

export default async function DatasetDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; datasetId: string }>;
}) {
  const { projectId, datasetId } = await params;
  const { role } = await requireProjectPermission(projectId, "datasets.read");
  const canFreeze = role ? projectRoleAllows(role, "datasets.freeze") : false;
  const canExport = role ? projectRoleAllows(role, "datasets.export") : false;

  const dataset = await prisma.dataset.findUnique({
    where: { id: datasetId },
    include: {
      versions: {
        orderBy: { frozenAt: "desc" },
        include: {
          frozenBy: { select: { email: true } },
          exports: { orderBy: { createdAt: "desc" } },
          _count: { select: { conversations: true } },
        },
      },
    },
  });
  if (!dataset || dataset.projectId !== projectId) notFound();

  // Eligible-for-freeze count.
  const acceptedCount = await prisma.conversation.count({
    where: { projectId, status: "accepted" },
  });

  // Recent runs to allow scoping freeze to a single run.
  const runs = await prisma.generationRun.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{dataset.name}</h1>
        {dataset.description && (
          <p className="mt-1 text-sm text-muted-foreground">{dataset.description}</p>
        )}
        <div className="mt-2 text-xs text-muted-foreground">
          {acceptedCount} accepted conversation{acceptedCount === 1 ? "" : "s"} eligible for freeze.
        </div>
      </div>

      {canFreeze && (
        <Card>
          <CardHeader>
            <CardTitle>Freeze a new version</CardTitle>
            <CardDescription>
              Snapshots a set of conversations into an immutable version. Defaults to all
              accepted conversations in this project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FreezeForm projectId={projectId} datasetId={datasetId} runs={runs} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Versions ({dataset.versions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {dataset.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          ) : (
            <VersionsList
              projectId={projectId}
              currentVersionId={dataset.currentVersionId}
              canExport={canExport}
              versions={dataset.versions.map((v) => ({
                id: v.id,
                version: v.version,
                description: v.description,
                frozenAt: v.frozenAt.toISOString(),
                frozenBy: v.frozenBy.email,
                conversationCount: v._count.conversations,
                exports: v.exports.map((e) => ({
                  id: e.id,
                  format: e.format,
                  status: e.status,
                  storagePath: e.storagePath,
                  rowCount: e.rowCount,
                  byteSize: e.byteSize ? Number(e.byteSize) : null,
                  createdAt: e.createdAt.toISOString(),
                })),
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
