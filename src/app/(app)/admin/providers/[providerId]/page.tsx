import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  GlobalProviderForm,
  type ExistingGlobalProvider,
} from "../global-provider-form";

export default async function EditGlobalProviderPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  await requirePermission("providers:write");

  const row = await prisma.globalProviderCredential.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      name: true,
      kind: true,
      baseUrl: true,
      defaultModel: true,
      reasoningEffort: true,
      keyFingerprint: true,
    },
  });
  if (!row) notFound();

  const existing: ExistingGlobalProvider = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    reasoningEffort: row.reasoningEffort,
    keyFingerprint: row.keyFingerprint,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{row.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit global provider
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/providers">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to providers
          </Link>
        </Button>
      </div>
      <GlobalProviderForm existing={existing} />
    </div>
  );
}
