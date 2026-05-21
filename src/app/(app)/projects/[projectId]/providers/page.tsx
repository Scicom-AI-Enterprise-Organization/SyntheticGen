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
import { ProvidersTable } from "./providers-table";
import { ImportGlobalsDialog } from "./import-globals-dialog";

export default async function ProvidersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "providers.manage");
  const canWrite = role ? projectRoleAllows(role, "providers.manage") : false;

  const providers = await prisma.providerCredential.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      baseUrl: true,
      keyFingerprint: true,
      defaultModel: true,
      reasoningEffort: true,
      chatTemplateKwargs: true,
      createdAt: true,
      sourceGlobalProviderId: true,
    },
  });

  // Globals available to import. We surface every active global; rows the
  // project has already imported (matched by sourceGlobalProviderId) show as
  // disabled with an "already imported" badge so the user can still see them
  // but doesn't accidentally double-import.
  const globals = canWrite
    ? await prisma.globalProviderCredential.findMany({
        where: { archivedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          kind: true,
          baseUrl: true,
          defaultModel: true,
        },
      })
    : [];
  const importedGlobalIds = new Set(
    providers.map((p) => p.sourceGlobalProviderId).filter(Boolean),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            OpenAI-compatible model endpoints. Same wire format works for vLLM, Together, OpenRouter,
            SGLang, and Anthropic via proxy. API keys are AES-256-GCM encrypted at rest and decrypted
            only inside the Python worker.
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <ImportGlobalsDialog
              projectId={projectId}
              globals={globals.map((g) => ({
                id: g.id,
                name: g.name,
                kind: g.kind,
                baseUrl: g.baseUrl,
                defaultModel: g.defaultModel,
                alreadyImported: importedGlobalIds.has(g.id),
              }))}
            />
            <Button asChild size="sm">
              <Link href={`/projects/${projectId}/providers/new`}>
                <Plus className="mr-1 h-4 w-4" />
                New provider
              </Link>
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Providers ({providers.length})</CardTitle>
          <CardDescription>Only the last-4 of each API key is shown.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProvidersTable
            projectId={projectId}
            canWrite={canWrite}
            providers={providers.map((p) => ({
              id: p.id,
              name: p.name,
              kind: p.kind,
              baseUrl: p.baseUrl,
              keyFingerprint: p.keyFingerprint,
              defaultModel: p.defaultModel,
              reasoningEffort: p.reasoningEffort,
              chatTemplateKwargs: (p.chatTemplateKwargs ?? null) as Record<string, unknown> | null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
