import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RunLiveStatus } from "./run-live-status";
import { CancelRunButton } from "./cancel-run-button";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; runId: string }>;
}) {
  const { projectId, runId } = await params;
  const { role } = await requireProjectPermission(projectId, "runs.read");
  const canCancel = role ? projectRoleAllows(role, "runs.cancel") : false;

  const [run, jobsByStatus] = await Promise.all([
    prisma.generationRun.findUnique({
      where: { id: runId },
      include: {
        template: { select: { name: true } },
        languageProfile: { select: { name: true, register: true, allowParticles: true } },
        providerCredential: { select: { name: true, kind: true } },
      },
    }),
    prisma.generationJob.groupBy({
      by: ["status"],
      where: { runId },
      _count: { _all: true },
    }),
  ]);
  if (!run || run.projectId !== projectId) notFound();

  const counts = Object.fromEntries(jobsByStatus.map((j) => [j.status, j._count._all]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{run.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {run.template?.name ?? "—"} · {run.model} · profile {run.languageProfile?.name ?? "—"}
            {run.formalityPolicy !== "inherit" && (
              <Badge variant="default" className="ml-2 text-[10px]">
                lock: {run.formalityPolicy}
              </Badge>
            )}
          </p>
        </div>
        {canCancel && (run.status === "queued" || run.status === "running") && (
          <CancelRunButton projectId={projectId} runId={runId} />
        )}
      </div>

      <RunLiveStatus
        projectId={projectId}
        runId={runId}
        initial={{
          status: run.status,
          producedCount: run.producedCount,
          targetCount: run.targetCount,
          acceptedCount: run.acceptedCount,
          tokensIn: Number(run.tokensIn),
          tokensOut: Number(run.tokensOut),
          costUsd: run.costUsd ? Number(run.costUsd) : 0,
          counts: {
            pending: counts["pending"] ?? 0,
            running: counts["running"] ?? 0,
            succeeded: counts["succeeded"] ?? 0,
            failed: counts["failed"] ?? 0,
            skipped: counts["skipped"] ?? 0,
          },
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Configuration snapshot</CardTitle>
          <CardDescription>Frozen at run start.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-[11px] leading-snug">
            {JSON.stringify(run.configSnapshot, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <div>
        <Link
          href={`/projects/${projectId}/conversations?runId=${runId}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          View generated conversations <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
