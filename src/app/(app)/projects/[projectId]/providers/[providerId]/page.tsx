import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { ProviderForm, type ExistingProvider } from "../provider-form";

export default async function EditProviderPage({
  params,
}: {
  params: Promise<{ projectId: string; providerId: string }>;
}) {
  const { projectId, providerId } = await params;
  await requireProjectPermission(projectId, "providers.manage");

  const provider = await prisma.providerCredential.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      projectId: true,
      name: true,
      kind: true,
      baseUrl: true,
      keyFingerprint: true,
      defaultModel: true,
      reasoningEffort: true,
      chatTemplateKwargs: true,
    },
  });
  if (!provider || provider.projectId !== projectId) notFound();

  const existing: ExistingProvider = {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    reasoningEffort: provider.reasoningEffort,
    chatTemplateKwargs: (provider.chatTemplateKwargs ?? null) as Record<string, unknown> | null,
    keyFingerprint: provider.keyFingerprint,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{provider.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Edit provider</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/providers`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to providers
          </Link>
        </Button>
      </div>
      <ProviderForm
        projectId={projectId}
        existing={existing}
        card={{
          title: "Provider",
          description:
            "Leave the API key blank to keep the current one. Changes require a fresh test before saving.",
        }}
      />
    </div>
  );
}
