import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { ToolForm } from "../tool-form";

export default async function NewToolPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "tools.write");

  let catalog = await prisma.toolCatalog.findFirst({
    where: { projectId, name: "default" },
    include: { tools: { select: { name: true, description: true } } },
  });
  if (!catalog) {
    catalog = await prisma.toolCatalog.create({
      data: { projectId, name: "default", description: "Default tool catalog" },
      include: { tools: { select: { name: true, description: true } } },
    });
  }
  if (!catalog) redirect(`/projects/${projectId}/tools`);

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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New tool</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/tools`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to tools
          </Link>
        </Button>
      </div>
      <ToolForm
        projectId={projectId}
        catalogId={catalog.id}
        providers={providers}
        taxonomyNodes={taxonomyNodes.map((t) => t.name)}
        existingTools={catalog.tools.map(
          (t) => `${t.name}${t.description ? ` — ${t.description.slice(0, 80)}` : ""}`,
        )}
        card={{
          title: "Tool",
          description: (
            <>
              Catalog: <code>{catalog.name}</code>. Use AI-assist to draft a tool from a sentence —
              e.g. &ldquo;look up a bank account balance by account number&rdquo; or &ldquo;check the
              status of a delivery by tracking number.&rdquo;
            </>
          ),
        }}
      />
    </div>
  );
}
