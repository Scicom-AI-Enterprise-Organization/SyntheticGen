import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProviderForm } from "./provider-form";
import { ProvidersTable } from "./providers-table";

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
      createdAt: true,
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Providers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          OpenAI-compatible model endpoints. Same wire format works for vLLM, Together, OpenRouter,
          SGLang, and Anthropic via proxy. API keys are AES-256-GCM encrypted at rest and decrypted
          only inside the Python worker.
        </p>
      </div>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>Add provider</CardTitle>
          </CardHeader>
          <CardContent>
            <ProviderForm projectId={projectId} />
          </CardContent>
        </Card>
      )}

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
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
