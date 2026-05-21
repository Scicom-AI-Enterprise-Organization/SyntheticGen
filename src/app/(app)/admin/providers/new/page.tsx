import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { GlobalProviderForm } from "../global-provider-form";

export default async function NewGlobalProviderPage() {
  await requirePermission("providers:write");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          New global provider
        </h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/providers">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to providers
          </Link>
        </Button>
      </div>
      <GlobalProviderForm />
    </div>
  );
}
