import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TaxonomyEditor } from "./taxonomy-editor";

export default async function TaxonomyPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "taxonomy.read");
  const canWrite = role ? projectRoleAllows(role, "taxonomy.write") : false;

  // Slice 1 ships with a single default taxonomy per project.
  // Auto-create a "default" taxonomy on first visit so users have something to attach nodes to.
  let taxonomy = await prisma.taxonomy.findFirst({
    where: { projectId, name: "default" },
    include: { nodes: { orderBy: { path: "asc" } } },
  });

  if (!taxonomy && canWrite) {
    taxonomy = await prisma.taxonomy.create({
      data: { projectId, name: "default", description: "Default taxonomy" },
      include: { nodes: { orderBy: { path: "asc" } } },
    });
  }

  const providers = await prisma.providerCredential.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, defaultModel: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Taxonomy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Topic tree used to drive coverage. Slice 1 supports a single flat list of nodes per project.
          Tree branching, multiple taxonomies, and intent examples come in a later slice.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nodes</CardTitle>
          <CardDescription>
            {taxonomy?.nodes.length ?? 0} node
            {taxonomy?.nodes.length === 1 ? "" : "s"} in <code>default</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {taxonomy ? (
            <TaxonomyEditor
              projectId={projectId}
              taxonomyId={taxonomy.id}
              canWrite={canWrite}
              providers={providers}
              nodes={taxonomy.nodes.map((n) => ({
                id: n.id,
                name: n.name,
                slug: n.slug,
                path: n.path,
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No taxonomy yet — and you don&apos;t have permission to create one.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
