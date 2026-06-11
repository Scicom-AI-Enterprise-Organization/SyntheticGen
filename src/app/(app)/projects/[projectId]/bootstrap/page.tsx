import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StartForm } from "./start-form";
import { JobView } from "./job-view";

export default async function BootstrapPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ jobId?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  await requireProjectPermission(projectId, "project.update");

  // If ?jobId=… is set, render that specific job. Otherwise show the most
  // recent non-terminal job (so reload picks up an in-flight bootstrap), or
  // fall back to the start form.
  let job = null;
  if (sp.jobId) {
    job = await prisma.bootstrapJob.findFirst({
      where: { id: sp.jobId, projectId },
    });
  } else {
    job = await prisma.bootstrapJob.findFirst({
      where: {
        projectId,
        status: { in: ["queued", "running"] },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  const providers = await prisma.providerCredential.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, defaultModel: true },
  });

  // Existing tools — surfaced to StartForm so it can (a) suggest skipping
  // the Tools phase, (b) seed the "Suggest prompt" button with the tool
  // catalog so the generated prompt fits this project, and (c) bias the
  // rest of bootstrap (taxonomy / personas / templates / flows) toward the
  // catalog rather than inventing from scratch.
  const existingTools = await prisma.toolDef.findMany({
    where: { catalog: { projectId } },
    select: { name: true, description: true },
    orderBy: { name: "asc" },
    take: 80,
  });
  const existingToolsCount = existingTools.length;
  const existingToolsSummary =
    existingTools.length > 0
      ? existingTools
          .map(
            (t) =>
              `- ${t.name}: ${t.description.replace(/\s+/g, " ").trim().slice(0, 200)}`,
          )
          .join("\n")
      : null;

  const recent = await prisma.bootstrapJob.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: {
      id: true,
      status: true,
      prompt: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bootstrap</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One prompt → taxonomy + languages + personas + templates + tools +
            flows + rubrics + benchmarks. Streams progress live; safe to
            navigate away while it runs.
          </p>
        </div>
        {sp.jobId ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/projects/${projectId}/bootstrap`}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back to bootstrap
            </Link>
          </Button>
        ) : (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/projects/${projectId}`}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back to project
            </Link>
          </Button>
        )}
      </div>

      {providers.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a provider first</CardTitle>
            <CardDescription>
              Bootstrap needs at least one configured LLM provider to call
              for entity generation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/projects/${projectId}/providers`}>
                Add provider
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : job ? (
        <JobView
          initial={{
            id: job.id,
            projectId,
            prompt: job.prompt,
            status: job.status,
            currentStep: job.currentStep,
            scope: job.scope as unknown as Record<string, boolean>,
            events:
              (job.events as unknown as Array<{
                idx: number;
                ts: string;
                step: string;
                kind: string;
                payload?: Record<string, unknown>;
              }>) ?? [],
            inserted:
              (job.inserted as unknown as Record<string, number>) ?? {},
            // Persisted at phase-end only (one DB write per AI call instead
            // of one every 300ms during streaming). Means refresh mid-stream
            // doesn't replay in-flight tokens — but it does show whatever
            // the last completed phase produced, with its terminal state.
            currentPhaseBuffer:
              (job.currentPhaseBuffer as unknown as {
                step: string;
                phaseIndex: number;
                text: string;
                state?: "done" | "error";
                error?: string;
              } | null) ?? null,
            error: job.error,
            startedAt: job.startedAt?.toISOString() ?? null,
            completedAt: job.completedAt?.toISOString() ?? null,
          }}
        />
      ) : (
        <StartForm
          projectId={projectId}
          providers={providers}
          existingToolsCount={existingToolsCount}
          existingToolsSummary={existingToolsSummary}
        />
      )}

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
            <CardDescription>
              Past bootstrap jobs for this project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/projects/${projectId}/bootstrap?jobId=${r.id}`}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm">{r.prompt}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.createdAt.toLocaleString()}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {r.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
