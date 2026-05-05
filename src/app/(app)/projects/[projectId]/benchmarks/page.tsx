import Link from "next/link";
import { ArrowRight, FlaskConical } from "lucide-react";
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
import { CreateBenchmarkForm } from "./create-benchmark-form";

export default async function BenchmarksPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "benchmarks.read");
  const canWrite = role ? projectRoleAllows(role, "benchmarks.write") : false;

  const benchmarks = await prisma.benchmark.findMany({
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
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Benchmarks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Evaluate any OpenAI-compatible model against a published dataset. Counterpart to Runs:
          Runs <em>generate</em> data, Benchmarks <em>consume</em> it to score models. Each run
          targets one (Provider × Model); compare runs to build a leaderboard.
        </p>
      </div>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>New benchmark</CardTitle>
            <CardDescription>
              Point at a HuggingFace dataset like{" "}
              <code className="font-mono">hf:Scicom-intl/Function-Call</code> and pick which
              splits to evaluate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateBenchmarkForm projectId={projectId} />
          </CardContent>
        </Card>
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
