import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RunMetricsPanel } from "./run-metrics-panel";
import { ResultsTable, type ResultRow } from "./results-table";
import { RestartBenchmarkRunButton } from "./restart-button";
import { LiveBenchmarkPreview } from "./live-benchmark-preview";
import { ExportToLabelingDialog } from "./export-to-labeling-dialog";
import { EnsembleDialog } from "./ensemble-dialog";
import { projectRoleAllows } from "@/lib/project-rbac";

export default async function BenchmarkRunPage({
  params,
}: {
  params: Promise<{ projectId: string; benchmarkId: string; runId: string }>;
}) {
  const { projectId, benchmarkId, runId } = await params;
  const { role } = await requireProjectPermission(projectId, "benchmarks.read");
  const canRestart = role ? projectRoleAllows(role, "benchmarks.execute") : false;

  // Look up the labeling-platform connection saved on the project so the
  // export dialog can pre-fill the URL and skip the token field if one
  // is stored. We never read the encrypted blob client-side — only the
  // boolean "is one configured".
  const projectMeta = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      labelingBaseUrl: true,
      labelingApiKeyEnc: true,
    },
  });
  const labelingBaseUrl = projectMeta?.labelingBaseUrl ?? null;
  const hasLabelingApiKey = !!projectMeta?.labelingApiKeyEnc;

  // Load every ensemble group for this project + the benchmark's
  // saved default. The run-page ensemble dialog renders these as a
  // dropdown so the user can pick which group to use for this
  // particular re-judge.
  const [ensembleGroupsRaw, benchmarkRow, allProviders] = await Promise.all([
    prisma.ensembleJudgeGroup.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true, judges: true },
    }),
    prisma.benchmark.findUnique({
      where: { id: benchmarkId },
      select: { defaultEnsembleGroupId: true },
    }),
    prisma.providerCredential.findMany({
      where: { projectId },
      select: { id: true, name: true, kind: true },
    }),
  ]);
  const providerById = new Map(allProviders.map((p) => [p.id, p]));
  const ensembleGroups = ensembleGroupsRaw.map((g) => {
    const raw = g.judges as unknown;
    const arr = typeof raw === "string"
      ? (() => {
          try { return JSON.parse(raw); } catch { return null; }
        })()
      : raw;
    const judges: Array<{
      providerCredentialId: string;
      providerName: string;
      providerKind: string;
      model: string;
    }> = [];
    if (Array.isArray(arr)) {
      for (const j of arr) {
        if (
          j &&
          typeof j === "object" &&
          typeof (j as Record<string, unknown>).providerCredentialId === "string" &&
          typeof (j as Record<string, unknown>).model === "string"
        ) {
          const pid = (j as { providerCredentialId: string }).providerCredentialId;
          const p = providerById.get(pid);
          if (!p) continue;
          judges.push({
            providerCredentialId: pid,
            providerName: p.name,
            providerKind: p.kind,
            model: (j as { model: string }).model,
          });
        }
      }
    }
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      judges,
    };
  });
  const defaultEnsembleGroupId = benchmarkRow?.defaultEnsembleGroupId ?? null;

  const run = await prisma.benchmarkRun.findFirst({
    where: { id: runId, benchmarkId },
    include: {
      benchmark: { select: { id: true, projectId: true, name: true, kind: true } },
      providerCredential: { select: { name: true, kind: true } },
      judgeProvider: { select: { name: true, kind: true } },
      rubric: { select: { id: true, name: true, axes: true } },
    },
  });
  if (!run || run.benchmark.projectId !== projectId) notFound();

  const results = await prisma.benchmarkResult.findMany({
    // Filter out per-turn detail rows (kind='chat-replay-turn') — they
    // exist for drill-down but the table shows one row per conversation.
    // Per-turn details are surfaced in the expanded view of the
    // conversation-level row instead.
    where: { runId, kind: { not: "chat-replay-turn" } },
    orderBy: [{ judgeVerdict: "asc" }, { rowIdx: "asc" }],
    take: 500,
  });

  const isChatReplay = run.benchmark.kind === "project-chat-replay";
  const rubricAxes =
    (run.rubric?.axes as Array<{ key: string; name?: string; scale?: number }> | null) ?? null;

  const resultRows: ResultRow[] = results.map((r) => ({
    id: r.id,
    kind: r.kind,
    split: r.split,
    rowIdx: r.rowIdx,
    turnNum: r.turnNum,
    conversationId: r.conversationId,
    judgeVerdict: r.judgeVerdict,
    judgeRationale: r.judgeRationale,
    judgeScores: (r.judgeScores as Record<string, number> | null) ?? null,
    validatorScores: (r.validatorScores as Record<string, unknown> | null) ?? null,
    functionCallScore: (r.functionCallScore as unknown[] | null) ?? null,
    referenceMessages: (r.referenceMessages as unknown[] | null) ?? null,
    candidateMessages: (r.candidateMessages as unknown[] | null) ?? null,
    expected: (r.expected as unknown[] | null) ?? null,
    predicted: (r.predicted as unknown[] | null) ?? null,
    resultType: r.resultType,
    funcMatch: r.funcMatch,
    paramAccuracy: r.paramAccuracy,
    similarity: r.similarity,
    apiFailed: r.apiFailed,
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
    costUsd: r.costUsd ? Number(r.costUsd) : null,
    ensembleResult: (r.ensembleResult as Record<string, unknown> | null) ?? null,
    ensembledAt: r.ensembledAt ? r.ensembledAt.toISOString() : null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/benchmarks/${benchmarkId}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {run.benchmark.name}
        </Link>
        {(() => {
          // BenchmarkRun.samplingParams stores judge_strategy + concurrency
          // among the user's per-run config. Surface them as header badges
          // so reviewers can tell at a glance how a run was configured
          // without having to expand expressions in raw JSON.
          const sp =
            (run.samplingParams as
              | {
                  judge_strategy?: string;
                  concurrency?: number;
                }
              | null
              | undefined) ?? null;
          const judgeStrategy = sp?.judge_strategy ?? "one-shot";
          const concurrency = typeof sp?.concurrency === "number" ? sp.concurrency : null;
          return (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            Run
            <code className="font-mono text-sm">{run.id.slice(0, 12)}</code>
            <Badge variant="outline" className="text-[10px]">
              {run.status}
            </Badge>
            {isChatReplay && (
              <>
                <Badge variant="outline" className="text-[10px]">
                  replay: {run.mode}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  judge: {judgeStrategy}
                </Badge>
                {concurrency != null && concurrency > 1 && (
                  <Badge variant="outline" className="text-[10px]">
                    parallel: {concurrency}
                  </Badge>
                )}
              </>
            )}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            {canRestart && run.status === "completed" && (
              <EnsembleDialog
                projectId={projectId}
                runId={run.id}
                groups={ensembleGroups}
                defaultGroupId={defaultEnsembleGroupId}
              />
            )}
            {canRestart && run.status === "completed" && (
              <ExportToLabelingDialog
                projectId={projectId}
                runId={run.id}
                benchmarkName={run.benchmark.name}
                labelingBaseUrl={labelingBaseUrl}
                hasLabelingApiKey={hasLabelingApiKey}
              />
            )}
            {canRestart && (
              <RestartBenchmarkRunButton
                projectId={projectId}
                runId={run.id}
                status={run.status}
                completedTurns={run.completedTurns}
                totalTurns={run.totalTurns}
              />
            )}
          </div>
        </div>
          );
        })()}
        <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground/70">Candidate:</span>{" "}
            <span className="font-mono">{run.model}</span>{" "}
            <span className="text-muted-foreground/70">via {run.providerCredential.name}</span>
          </div>
          {run.judgeProvider && (
            <div>
              <span className="text-muted-foreground/70">Judge:</span>{" "}
              <span className="font-mono">{run.judgeModel}</span>{" "}
              <span className="text-muted-foreground/70">via {run.judgeProvider.name}</span>
            </div>
          )}
          {run.rubric && (
            <div>
              <span className="text-muted-foreground/70">Rubric:</span>{" "}
              <Link
                href={`/projects/${projectId}/rubrics/${run.rubric.id}`}
                className="font-mono hover:text-foreground"
              >
                {run.rubric.name}
              </Link>
            </div>
          )}
          <div>
            <span className="text-muted-foreground/70">Progress:</span>{" "}
            {run.completedTurns}/{run.totalTurns} ({run.failedTurns} failed)
          </div>
          <div>
            <span className="text-muted-foreground/70">Tokens:</span>{" "}
            {Number(run.tokensIn).toLocaleString()} in /{" "}
            {Number(run.tokensOut).toLocaleString()} out
            {run.costUsd != null && (
              <>
                {" · "}cost ${Number(run.costUsd).toFixed(4)}
              </>
            )}
          </div>
        </div>
        {run.lastError && (
          <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {run.lastError}
          </p>
        )}
        {(() => {
          // Calibration drift report — populated by the worker at the
          // start of the run if any calibration items exist. Show it
          // prominently so reviewers know whether to trust the rankings.
          const raw = run.calibrationReport as unknown;
          type CalibReport = {
            items?: Array<{
              conversationId?: string;
              maxDelta?: number;
              delta?: Record<string, number>;
            }>;
            maxDelta?: number;
            meanDelta?: number;
            driftFlagged?: boolean;
            threshold?: number;
          };
          let parsed: CalibReport | null = null;
          if (typeof raw === "string") {
            try {
              const p = JSON.parse(raw);
              if (p && typeof p === "object" && !Array.isArray(p)) {
                parsed = p as CalibReport;
              }
            } catch {
              parsed = null;
            }
          } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            parsed = raw as CalibReport;
          }
          if (!parsed || !parsed.items || parsed.items.length === 0) return null;
          const report = parsed;
          const flagged = report.driftFlagged === true;
          return (
            <div
              className={`mt-2 rounded-md border px-2 py-1.5 text-xs ${
                flagged
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
              }`}
            >
              <div className="font-medium">
                Calibration drift: {flagged ? "FLAGGED" : "within threshold"}
              </div>
              <div className="mt-0.5 text-[11px] opacity-90">
                {(report.items?.length ?? 0)} calibration item
                {(report.items?.length ?? 0) === 1 ? "" : "s"} · max axis delta{" "}
                <span className="font-mono">
                  {(report.maxDelta ?? 0).toFixed(2)}
                </span>{" "}
                · mean{" "}
                <span className="font-mono">
                  {(report.meanDelta ?? 0).toFixed(2)}
                </span>{" "}
                · threshold{" "}
                <span className="font-mono">
                  {(report.threshold ?? 1).toFixed(2)}
                </span>
                {flagged && (
                  <>
                    {" · "}
                    <span className="italic">
                      Judge has drifted from baseline — investigate before
                      trusting this run's rankings.
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      <LiveBenchmarkPreview
        projectId={projectId}
        benchmarkId={benchmarkId}
        runId={run.id}
        initialStatus={run.status}
      />

      <Card>
        <CardHeader>
          <CardTitle>Metrics</CardTitle>
          <CardDescription>
            {isChatReplay
              ? "Aggregate axis scores, validator pass rates, and (where applicable) function-call accuracy across all replayed conversations."
              : "Function-call accuracy across all evaluated turns."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunMetricsPanel
            metrics={(run.metrics as Record<string, unknown> | null) ?? null}
            rubricAxes={rubricAxes}
            isChatReplay={isChatReplay}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-item results ({resultRows.length})</CardTitle>
          <CardDescription>
            Click a row to expand the reference, candidate, judge rationale, validator verdicts,
            and (if any) function-call comparison.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResultsTable
            projectId={projectId}
            results={resultRows}
            rubricAxes={rubricAxes}
            isChatReplay={isChatReplay}
          />
        </CardContent>
      </Card>
    </div>
  );
}
