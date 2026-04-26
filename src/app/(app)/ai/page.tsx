import { requireUser } from "@/lib/rbac";
import { AIWorkspace } from "./ai-workspace";

export default async function AIPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Workspace</h1>
        <p className="mt-2 text-muted-foreground">
          Chat assistant, voice IO, agent suggestions, structured flows, and
          AI-generated summaries — every showcase AI pattern in one screen.
        </p>
      </div>
      <AIWorkspace />
    </div>
  );
}
