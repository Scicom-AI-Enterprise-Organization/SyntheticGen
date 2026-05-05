import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FlaskConical, Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StartRunForm } from "./start-run-form";
import { RunsTable } from "./runs-table";
import { DeleteBenchmarkButton } from "./delete-benchmark-button";

export default async function BenchmarkDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; benchmarkId: string }>;
}) {
  const { projectId, benchmarkId } = await params;
  const { role } = await requireProjectPermission(projectId, "benchmarks.read");
  const canExecute = role ? projectRoleAllows(role, "benchmarks.execute") : false;
  const canWrite = role ? projectRoleAllows(role, "benchmarks.write") : false;
  const canCancel = role ? projectRoleAllows(role, "benchmarks.cancel") : false;

  const [benchmark, providers] = await Promise.all([
    prisma.benchmark.findUnique({
      where: { id: benchmarkId },
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { providerCredential: { select: { name: true, kind: true } } },
        },
      },
    }),
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, defaultModel: true },
    }),
  ]);
  if (!benchmark || benchmark.projectId !== projectId) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Link href={`/projects/${projectId}/benchmarks`} className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Benchmarks
            </Link>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FlaskConical className="h-5 w-5" />
            {benchmark.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{benchmark.source}</span>
            {" · "}
            splits: {benchmark.splits.join(" / ")}
            {benchmark.maxRowsPerSplit && ` · capped at ${benchmark.maxRowsPerSplit}/split`}
          </p>
          {benchmark.description && (
            <p className="mt-1 text-xs text-muted-foreground">{benchmark.description}</p>
          )}
        </div>
        {canWrite && <DeleteBenchmarkButton projectId={projectId} benchmarkId={benchmark.id} />}
      </div>

      {canExecute && (
        <Card>
          <CardHeader>
            <CardTitle>Start a run</CardTitle>
            <CardDescription>
              Pick a provider and model. The Python worker fetches the dataset, walks rows,
              calls the model with the row&apos;s tools, and scores predicted vs. expected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No providers configured. Add one under <code>Providers</code>.
              </p>
            ) : (
              <StartRunForm
                projectId={projectId}
                benchmarkId={benchmark.id}
                providers={providers}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Runs ({benchmark.runs.length})</CardTitle>
          <CardDescription>Latest first. Compare across models for a leaderboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <RunsTable
            projectId={projectId}
            benchmarkId={benchmark.id}
            canCancel={canCancel}
            runs={benchmark.runs.map((r) => ({
              id: r.id,
              status: r.status,
              model: r.model,
              providerName: r.providerCredential.name,
              providerKind: r.providerCredential.kind,
              totalTurns: r.totalTurns,
              completedTurns: r.completedTurns,
              failedTurns: r.failedTurns,
              metrics: (r.metrics as Record<string, unknown> | null) ?? null,
              startedAt: r.startedAt?.toISOString() ?? null,
              completedAt: r.completedAt?.toISOString() ?? null,
              createdAt: r.createdAt.toISOString(),
              lastError: r.lastError,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
