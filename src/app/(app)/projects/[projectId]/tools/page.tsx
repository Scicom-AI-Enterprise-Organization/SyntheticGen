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

  const providers = await prisma.providerCredential.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, defaultModel: true },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Function/tool definitions in the OpenAI tools schema. Slice 1 captures the catalog;
          generation runs will start passing tools to the model in a later slice. MY-local presets
          like <Badge variant="outline" className="text-[10px]">mykad</Badge>{" "}
          <Badge variant="outline" className="text-[10px]">lhdn</Badge>{" "}
          <Badge variant="outline" className="text-[10px]">maybank</Badge>{" "}
          <Badge variant="outline" className="text-[10px]">tng</Badge>{" "}
          <Badge variant="outline" className="text-[10px]">duitnow</Badge>{" "}
          tag a tool for the future mock-executor.
        </p>
      </div>

      {canWrite && catalog && (
        <Card>
          <CardHeader>
            <CardTitle>New tool</CardTitle>
            <CardDescription>
              Catalog: <code>{catalog.name}</code>. Use AI-assist to draft a tool from a sentence
              like &ldquo;a function that looks up a Maybank account balance by account number.&rdquo;
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ToolForm projectId={projectId} catalogId={catalog.id} providers={providers} />
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
