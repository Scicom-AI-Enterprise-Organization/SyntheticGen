import { TerminalSquare } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlaygroundForm } from "./playground-form";

// Standalone scratchpad for poking at the GlobalProviderCredential pool.
// Lives outside any project so it stays useful for one-off "does this
// endpoint actually stream tool_calls?" checks without polluting a real
// project's run history. Streams reasoning + content + tool-call deltas
// from upstream and shows raw + structured views side by side.
export default async function PlaygroundPage() {
  await requireUser();

  const providers = await prisma.globalProviderCredential.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      baseUrl: true,
      defaultModel: true,
      reasoningEffort: true,
      chatTemplateKwargs: true,
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <TerminalSquare className="h-5 w-5" />
          Playground
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send one-off chat-completion requests to any global provider. Streams
          reasoning, content, and tool-call deltas live. Use the Import button
          to paste a Python <code>requests.post(...)</code> snippet — the form
          will fill itself in from <code>headers</code> + <code>json_data</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
          <CardDescription>
            Pick a global provider as the credential source, then tweak any
            request param. Tools, <code>tool_choice</code>,
            <code>reasoning_effort</code>, and{" "}
            <code>chat_template_kwargs</code> are all exposed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No global providers configured. Ask an admin to add one under{" "}
              <code>/admin/providers</code>.
            </p>
          ) : (
            <PlaygroundForm
              providers={providers.map((p) => ({
                id: p.id,
                name: p.name,
                kind: p.kind,
                baseUrl: p.baseUrl,
                defaultModel: p.defaultModel,
                reasoningEffort: p.reasoningEffort,
                chatTemplateKwargs:
                  p.chatTemplateKwargs &&
                  typeof p.chatTemplateKwargs === "object" &&
                  !Array.isArray(p.chatTemplateKwargs)
                    ? JSON.stringify(p.chatTemplateKwargs)
                    : null,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
