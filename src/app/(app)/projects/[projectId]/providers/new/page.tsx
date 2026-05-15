import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { ProviderForm } from "../provider-form";

export default async function NewProviderPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "providers.manage");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New provider</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/providers`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to providers
          </Link>
        </Button>
      </div>
      <ProviderForm
        projectId={projectId}
        card={{
          title: "Provider",
          description:
            "OpenAI-compatible endpoint. The key is AES-256-GCM encrypted at rest and decrypted only inside the Python worker.",
        }}
      />
    </div>
  );
}
