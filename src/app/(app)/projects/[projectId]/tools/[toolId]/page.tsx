import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { ToolForm, type InitialTool } from "../tool-form";

export default async function EditToolPage({
  params,
}: {
  params: Promise<{ projectId: string; toolId: string }>;
}) {
  const { projectId, toolId } = await params;
  await requireProjectPermission(projectId, "tools.write");

  const tool = await prisma.toolDef.findUnique({
    where: { id: toolId },
    include: {
      catalog: { select: { id: true, projectId: true, name: true } },
    },
  });
  if (!tool || tool.catalog.projectId !== projectId) notFound();

  const [providers, taxonomyNodes, otherTools] = await Promise.all([
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
    prisma.toolDef.findMany({
      where: { catalogId: tool.catalogId, id: { not: tool.id } },
      orderBy: { name: "asc" },
      select: { name: true, description: true },
    }),
  ]);

  const examples = Array.isArray(tool.examples)
    ? (tool.examples as unknown[]).filter(
        (x): x is Record<string, unknown> =>
          x !== null && typeof x === "object" && !Array.isArray(x),
      )
    : [];

  const initial: InitialTool = {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    parametersJson: JSON.stringify(tool.parameters, null, 2),
    localePresets: tool.localePresets,
    examples,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tool.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Edit tool · v{tool.version}</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/tools`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to tools
          </Link>
        </Button>
      </div>
      <ToolForm
        projectId={projectId}
        catalogId={tool.catalogId}
        providers={providers}
        taxonomyNodes={taxonomyNodes.map((t) => t.name)}
        existingTools={otherTools.map(
          (t) => `${t.name}${t.description ? ` — ${t.description.slice(0, 80)}` : ""}`,
        )}
        initial={initial}
        card={{
          title: "Tool",
          description: (
            <>
              Catalog: <code>{tool.catalog.name}</code>. Body changes bump the version.
            </>
          ),
        }}
      />
    </div>
  );
}
