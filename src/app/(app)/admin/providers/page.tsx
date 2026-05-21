import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GlobalProvidersTable } from "./providers-table";

export default async function AdminProvidersPage() {
  await requirePermission("providers:write");

  const providers = await prisma.globalProviderCredential.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { imports: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Global providers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Org-wide LLM provider templates. Project owners import these into
            their own project providers — the import copies the encrypted key
            and every other field, so per-project edits stay isolated.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/providers/new">
            <Plus className="mr-1 h-4 w-4" />
            New provider
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates ({providers.length})</CardTitle>
          <CardDescription>
            Only the last-4 of each API key is shown. Decryption only happens
            inside the Python worker.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GlobalProvidersTable
            providers={providers.map((p) => ({
              id: p.id,
              name: p.name,
              kind: p.kind,
              baseUrl: p.baseUrl,
              keyFingerprint: p.keyFingerprint,
              defaultModel: p.defaultModel,
              reasoningEffort: p.reasoningEffort,
              importCount: p._count.imports,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
