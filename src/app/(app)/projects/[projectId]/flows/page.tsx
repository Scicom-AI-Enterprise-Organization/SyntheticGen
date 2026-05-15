import Link from "next/link";
import { GitBranch, Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FlowsTable } from "./flows-table";

export default async function FlowsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "flows.read");
  const canWrite = role ? projectRoleAllows(role, "flows.write") : false;

  const flows = await prisma.flow.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      version: true,
      isPublished: true,
      updatedAt: true,
      nodes: true,
      edges: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hand-authored conversation graphs that drive multi-turn synthetic generation. Each flow
            is a DAG of <Badge variant="outline" className="text-[10px]">intent</Badge>{" "}
            <Badge variant="outline" className="text-[10px]">action</Badge>{" "}
            <Badge variant="outline" className="text-[10px]">condition</Badge>{" "}
            <Badge variant="outline" className="text-[10px]">end</Badge>{" "}
            nodes connected from a single Start. The worker walks paths to produce structured turn-by-turn
            conversations.
          </p>
        </div>
        {canWrite && (
          <Button asChild size="sm">
            <Link href={`/projects/${projectId}/flows/new`}>
              <Plus className="mr-1 h-4 w-4" />
              New flow
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Flows ({flows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {flows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              <GitBranch className="mx-auto mb-2 h-6 w-6" />
              No flows yet.
              {canWrite ? (
                <>
                  {" "}
                  <Link
                    href={`/projects/${projectId}/flows/new`}
                    className="text-primary hover:underline"
                  >
                    Create your first one.
                  </Link>
                </>
              ) : null}
            </div>
          ) : (
            <FlowsTable
              projectId={projectId}
              canWrite={canWrite}
              flows={flows.map((f) => {
                const nodes = Array.isArray(f.nodes) ? (f.nodes as unknown[]) : [];
                const edges = Array.isArray(f.edges) ? (f.edges as unknown[]) : [];
                return {
                  id: f.id,
                  name: f.name,
                  description: f.description,
                  version: f.version,
                  isPublished: f.isPublished,
                  updatedAt: f.updatedAt.toISOString(),
                  nodeCount: nodes.length,
                  edgeCount: edges.length,
                };
              })}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
