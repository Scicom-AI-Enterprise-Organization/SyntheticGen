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
import { ToolForm } from "./tool-form";
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

  const [providers, taxonomyNodes] = await Promise.all([
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultModel: true },
    }),
    prisma.taxonomyNode.findMany({
      where: { taxonomy: { projectId } },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tools</h1>
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
        <Card>
          <CardHeader>
            <CardTitle>New tool</CardTitle>
            <CardDescription>
              Catalog: <code>{catalog.name}</code>. Use AI-assist to draft a tool from a sentence
              — e.g. &ldquo;look up a bank account balance by account number&rdquo; or
              &ldquo;check the status of a delivery by tracking number.&rdquo;
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ToolForm
              projectId={projectId}
              catalogId={catalog.id}
              providers={providers}
              taxonomyNodes={taxonomyNodes.map((t) => t.name)}
              existingTools={catalog.tools.map((t) => `${t.name}${t.description ? ` — ${t.description.slice(0, 80)}` : ""}`)}
            />
          </CardContent>
        </Card>
      )}

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
