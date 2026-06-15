import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/rbac";
import { ApiKeyPanel } from "./api-key-panel";

export default async function ApiKeysPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API tokens</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Personal tokens for the SyntheticGen REST API — list runs and
            conversations, inspect generation traces, fetch tools and
            templates from scripts or other agents. Pass the token as a{" "}
            <code className="font-mono">Bearer</code> credential. Treat tokens
            like passwords.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/api-docs">
            <BookOpen className="mr-1 h-4 w-4" /> API docs
          </Link>
        </Button>
      </div>
      <ApiKeyPanel />
    </div>
  );
}
