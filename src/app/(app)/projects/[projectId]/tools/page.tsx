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
import { Badge } from "@/components/ui/badge";
import { ToolsTable } from "./tools-table";

export default async function ToolsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "tools.read");
  const canWrite = role ? projectRoleAllows(role, "tools.write") : false;

  // Auto-create a "default" catalog on first visit, mirroring how Taxonomy does it.
  let catalog = await prisma.toolCatalog.findFirst({
    where: { projectId, name: "default" },
    include: { tools: { orderBy: { name: "asc" } } },
  });
  if (!catalog && canWrite) {
    catalog = await prisma.toolCatalog.create({
      data: { projectId, name: "default", description: "Default tool catalog" },
      include: { tools: { orderBy: { name: "asc" } } },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tools</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Function/tool definitions in the OpenAI tools schema. Slice 1 captures the catalog;
            generation runs will start passing tools to the model in a later slice. Tag tools with
            locale or domain presets like{" "}
            <Badge variant="outline" className="text-[10px]">banking</Badge>{" "}
            <Badge variant="outline" className="text-[10px]">telco</Badge>{" "}
            <Badge variant="outline" className="text-[10px]">government</Badge>{" "}
            (or country-scoped tags like <code>mykad</code>, <code>siret</code>, <code>iban</code>)
            to wire them into the future mock-executor.
          </p>
        </div>
        {canWrite && catalog && (
          <Button asChild>
            <Link href={`/projects/${projectId}/tools/new`}>
              <Plus className="mr-2 h-4 w-4" />
              New tool
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tools ({catalog?.tools.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {catalog ? (
            <ToolsTable
              projectId={projectId}
              canWrite={canWrite}
              tools={catalog.tools.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                version: t.version,
                localePresets: t.localePresets,
                parameters: t.parameters,
                examples: (t.examples as Record<string, unknown>[] | null) ?? null,
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No catalog yet — and you don&apos;t have permission to create one.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
