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

export default async function BenchmarkRunPage({
  params,
}: {
  params: Promise<{ projectId: string; benchmarkId: string; runId: string }>;
}) {
  const { projectId, benchmarkId, runId } = await params;
  await requireProjectPermission(projectId, "benchmarks.read");

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
    where: { runId },
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
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          Run
          <code className="font-mono text-sm">{run.id.slice(0, 12)}</code>
          <Badge variant="outline" className="text-[10px]">
            {run.status}
          </Badge>
          {isChatReplay && (
            <Badge variant="outline" className="text-[10px]">
              {run.mode}
            </Badge>
          )}
        </h1>
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
      </div>

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
            results={resultRows}
            rubricAxes={rubricAxes}
            isChatReplay={isChatReplay}
          />
        </CardContent>
      </Card>
    </div>
  );
}
