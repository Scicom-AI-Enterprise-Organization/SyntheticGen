import Link from "next/link";
import { ArrowRight, FlaskConical, Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EnsembleJudgesCard } from "./ensemble-judges-card";

export default async function BenchmarksPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "benchmarks.read");
  const canWrite = role ? projectRoleAllows(role, "benchmarks.write") : false;

  const [benchmarks, project, providers] = await Promise.all([
    prisma.benchmark.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { runs: true } },
        runs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, model: true, createdAt: true, metrics: true },
        },
      },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { ensembleJudges: true },
    }),
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, defaultModel: true },
    }),
  ]);

  // Parse saved ensemble judges, defensively — JSONB columns sometimes
  // arrive as strings on legacy rows.
  let initialJudges: Array<{ providerCredentialId: string; model: string }> = [];
  const raw = project?.ensembleJudges as unknown;
  const arr = typeof raw === "string"
    ? (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })()
    : raw;
  if (Array.isArray(arr)) {
    for (const j of arr) {
      if (
        j &&
        typeof j === "object" &&
        typeof (j as Record<string, unknown>).providerCredentialId === "string" &&
        typeof (j as Record<string, unknown>).model === "string"
      ) {
        initialJudges.push({
          providerCredentialId: (j as { providerCredentialId: string }).providerCredentialId,
          model: (j as { model: string }).model,
        });
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Benchmarks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Replay project-generated conversations through a candidate model and score against the
            reference assistant turns with deterministic validators + an LLM judge. Each run targets
            one (Provider × Model); compare runs to build a leaderboard.
          </p>
        </div>
        {canWrite && (
          <Button asChild size="sm">
            <Link href={`/projects/${projectId}/benchmarks/new`}>
              <Plus className="mr-1 h-4 w-4" />
              New benchmark
            </Link>
          </Button>
        )}
      </div>

      {canWrite && (
        <EnsembleJudgesCard
          projectId={projectId}
          providers={providers.map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind,
            defaultModel: p.defaultModel,
          }))}
          initialJudges={initialJudges}
          disabled={!canWrite}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Benchmarks ({benchmarks.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {benchmarks.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              <FlaskConical className="mx-auto mb-2 h-6 w-6" />
              No benchmarks yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {benchmarks.map((b) => {
                const last = b.runs[0];
                const overall =
                  last?.metrics &&
                  typeof last.metrics === "object" &&
                  "overall" in last.metrics
                    ? (last.metrics as { overall?: { function_accuracy?: number } }).overall
                    : null;
                return (
                  <li key={b.id}>
                    <Link
                      href={`/projects/${projectId}/benchmarks/${b.id}`}
                      className="flex items-center justify-between gap-4 rounded-md px-2 py-3 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{b.name}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">{b.source}</span>
                          {b.splits.length > 0 && (
                            <span className="ml-2">
                              splits: {b.splits.map((s) => `${s}`).join(" / ")}
                            </span>
                          )}
                          {b.maxRowsPerSplit && (
                            <span className="ml-2">capped at {b.maxRowsPerSplit}/split</span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span>{b._count.runs} run{b._count.runs === 1 ? "" : "s"}</span>
                        {last && (
                          <>
                            <Badge variant="outline" className="text-[10px]">
                              {last.status}
                            </Badge>
                            <span className="font-mono">{last.model}</span>
                            {overall?.function_accuracy != null && (
                              <Badge variant="default" className="text-[10px]">
                                {Math.round(overall.function_accuracy * 100)}% func
                              </Badge>
                            )}
                          </>
                        )}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
