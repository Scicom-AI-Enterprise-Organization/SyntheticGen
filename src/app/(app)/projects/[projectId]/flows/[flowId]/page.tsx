import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import { FlowEditor } from "./flow-editor";
import type { FlowNode, FlowEdge } from "./types";

export default async function FlowDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; flowId: string }>;
}) {
  const { projectId, flowId } = await params;
  const { role } = await requireProjectPermission(projectId, "flows.read");
  const canWrite = role ? projectRoleAllows(role, "flows.write") : false;

  const [flow, tools, providers] = await Promise.all([
    prisma.flow.findUnique({ where: { id: flowId } }),
    // All tools across the project's catalogs — the inspector's tool picker uses these.
    prisma.toolDef.findMany({
      where: { catalog: { projectId } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        localePresets: true,
      },
    }),
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultModel: true },
    }),
  ]);
  if (!flow || flow.projectId !== projectId) notFound();

  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []) as unknown as FlowNode[];
  const edges = (Array.isArray(flow.edges) ? flow.edges : []) as unknown as FlowEdge[];

  return (
    // Take the full visible height; the editor manages its own internal layout.
    <div className="-mx-4 -my-2 flex h-[calc(100vh-3.5rem)] flex-col lg:-mx-8">
      <FlowEditor
        projectId={projectId}
        flow={{
          id: flow.id,
          name: flow.name,
          description: flow.description,
          isPublished: flow.isPublished,
          version: flow.version,
          nodes,
          edges,
        }}
        tools={tools.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          localePresets: t.localePresets,
        }))}
        providers={providers}
        canWrite={canWrite}
      />
    </div>
  );
}
