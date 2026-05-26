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
import { Badge } from "@/components/ui/badge";
import { StartRunForm } from "./start-run-form";
import { RunsTable } from "./runs-table";
import { DeleteBenchmarkButton } from "./delete-benchmark-button";
import { EditSourceDropdown } from "./edit-source-dropdown";

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

  const [benchmark, providers, rubrics, sourceRuns, ensembleGroups] = await Promise.all([
    prisma.benchmark.findUnique({
      where: { id: benchmarkId },
      include: {
        defaultRubric: { select: { id: true, name: true } },
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
    prisma.rubric.findMany({
      where: { projectId },
      orderBy: [{ isPreset: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isPreset: true },
    }),
    // Generation runs with at least one accepted conversation — the pool of
    // valid source runs for the Edit-source dialog. Mirrors the new-page
    // query so the dialog and create form stay in sync.
    prisma.generationRun.findMany({
      where: { projectId, acceptedCount: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        model: true,
        acceptedCount: true,
        createdAt: true,
      },
    }),
    prisma.ensembleJudgeGroup.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true, judges: true },
    }),
  ]);
  if (!benchmark || benchmark.projectId !== projectId) notFound();

  const providerById = new Map(providers.map((p) => [p.id, p]));

  // Expand judges (stored as JSONB) into a list of provider+model refs
  // so the dropdown can show "<provider> · <model>" lines.
  const ensembleGroupOptions = ensembleGroups.map((g) => {
    const raw = g.judges as unknown;
    const arr = typeof raw === "string"
      ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
      : raw;
    const judges = (Array.isArray(arr) ? arr : []).flatMap(
      (j: { providerCredentialId?: string; model?: string }) => {
        if (!j?.providerCredentialId || !j?.model) return [];
        const p = providerById.get(j.providerCredentialId);
        if (!p) return [];
        return [{
          providerCredentialId: j.providerCredentialId,
          providerName: p.name,
          providerKind: p.kind,
          model: j.model,
        }];
      },
    );
    return {
      id: g.id,
      name: g.name,
      description: g.description ?? null,
      judges,
      judgeCount: judges.length,
    };
  });

  const isChatReplay = benchmark.kind === "project-chat-replay";
  const benchmarkConfig =
    (benchmark.config as { mode?: string; filter?: Record<string, unknown> } | null) ?? null;
  const defaultMode =
    benchmarkConfig?.mode === "single-turn" || benchmarkConfig?.mode === "multi-turn"
      ? benchmarkConfig.mode
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Link href={`/projects/${projectId}/benchmarks`} className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Benchmarks
            </Link>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FlaskConical className="h-5 w-5" />
            {benchmark.name}
            <Badge variant="outline" className="text-[10px]">
              {benchmark.kind}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{benchmark.source}</span>
            {benchmark.splits.length > 0 && <> {" · "}splits: {benchmark.splits.join(" / ")}</>}
            {benchmark.maxRowsPerSplit && ` · capped at ${benchmark.maxRowsPerSplit}/split`}
            {isChatReplay && benchmark.frozenConversationIds.length > 0 && (
              <> {" · "}{benchmark.frozenConversationIds.length} frozen conversations</>
            )}
            {isChatReplay && defaultMode && <> {" · "}mode: {defaultMode}</>}
            {isChatReplay && benchmark.defaultRubric && (
              <> {" · "}rubric: <span className="font-mono">{benchmark.defaultRubric.name}</span></>
            )}
          </p>
          {benchmark.description && (
            <p className="mt-1 text-xs text-muted-foreground">{benchmark.description}</p>
          )}
        </div>
        {canWrite && <DeleteBenchmarkButton projectId={projectId} benchmarkId={benchmark.id} />}
      </div>

      {isChatReplay && canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>Source</CardTitle>
            <CardDescription>
              Pick which generation run (and how many conversations) the
              benchmark replays. Saving re-freezes the conversation list.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditSourceDropdown
              projectId={projectId}
              benchmarkId={benchmark.id}
              runs={sourceRuns.map((r) => ({
                id: r.id,
                name: r.name ?? "",
                model: r.model,
                acceptedCount: r.acceptedCount,
              }))}
              currentRunId={
                Array.isArray(
                  (benchmarkConfig?.filter as { runIds?: unknown })?.runIds,
                ) &&
                (
                  (benchmarkConfig?.filter as { runIds?: unknown[] }).runIds ?? []
                ).length === 1
                  ? (
                      (benchmarkConfig?.filter as { runIds: string[] }).runIds[0]
                    ) ?? null
                  : null
              }
              currentLimit={
                typeof (benchmarkConfig?.filter as { limit?: unknown })?.limit === "number"
                  ? ((benchmarkConfig?.filter as { limit: number }).limit)
                  : benchmark.frozenConversationIds.length
              }
              existingRunCount={benchmark.runs.length}
            />
          </CardContent>
        </Card>
      )}

      {canExecute && (
        <Card>
          <CardHeader>
            <CardTitle>Start a run</CardTitle>
            <CardDescription>
              Pick an ensemble judge group (1 judge = single-judge; ≥2 = consensus).
              The worker scores the reference assistant turns in every frozen
              conversation against the rubric. No candidate model is re-invoked.
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
                benchmarkKind={benchmark.kind}
                defaultMode={defaultMode}
                defaultRubricId={benchmark.defaultRubricId}
                defaultEnsembleGroupId={benchmark.defaultEnsembleGroupId}
                providers={providers}
                rubrics={rubrics}
                ensembleGroups={ensembleGroupOptions.map((g) => ({
                  id: g.id,
                  name: g.name,
                  description: g.description,
                  judges: g.judges,
                }))}
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
            benchmarkKind={benchmark.kind}
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
