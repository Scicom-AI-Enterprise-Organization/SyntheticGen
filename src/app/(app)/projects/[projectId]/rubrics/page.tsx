import Link from "next/link";
import { ArrowRight, Gauge } from "lucide-react";
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
import { RubricForm } from "./rubric-form";

export default async function RubricsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "benchmarks.read");
  const canWrite = role ? projectRoleAllows(role, "benchmarks.write") : false;

  const [rubrics, providers] = await Promise.all([
    prisma.rubric.findMany({
      where: { projectId },
      orderBy: [{ isPreset: "desc" }, { createdAt: "desc" }],
      include: {
        _count: { select: { benchmarkRuns: true, benchmarks: true } },
      },
    }),
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultModel: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rubrics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reusable scoring schemes for chat-replay benchmarks. Each rubric is a list of axes the
          LLM judge scores a candidate model on (e.g. language fidelity, register, helpfulness).
          Hand-write one or describe what you want in plain English and let AI draft it.
        </p>
      </div>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>New rubric</CardTitle>
            <CardDescription>
              Start from the Malaysia-focused defaults below, edit them, or hit{" "}
              <em>Fill with AI</em> to draft a rubric from a sentence.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RubricForm projectId={projectId} providers={providers} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Rubrics ({rubrics.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rubrics.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              <Gauge className="mx-auto mb-2 h-6 w-6" />
              No rubrics yet. Create one above to use in chat-replay benchmarks.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rubrics.map((r) => {
                const axes = Array.isArray(r.axes) ? r.axes : [];
                return (
                  <li key={r.id}>
                    <Link
                      href={`/projects/${projectId}/rubrics/${r.id}`}
                      className="flex items-center justify-between gap-4 rounded-md px-2 py-3 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-medium">
                          {r.name}
                          {r.isPreset && (
                            <Badge variant="outline" className="text-[10px]">
                              preset
                            </Badge>
                          )}
                          {r.aiDrafted && (
                            <Badge variant="secondary" className="text-[10px]">
                              AI-drafted
                            </Badge>
                          )}
                        </div>
                        {r.description && (
                          <div className="text-xs text-muted-foreground">{r.description}</div>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {axes.slice(0, 6).map((a, i) => {
                            const axis = a as { key?: string; name?: string };
                            return (
                              <Badge
                                key={i}
                                variant="outline"
                                className="font-mono text-[10px]"
                              >
                                {axis.name ?? axis.key ?? `axis ${i + 1}`}
                              </Badge>
                            );
                          })}
                          {axes.length > 6 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{axes.length - 6} more
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          {r._count.benchmarks} benchmark
                          {r._count.benchmarks === 1 ? "" : "s"}
                        </span>
                        <span>
                          {r._count.benchmarkRuns} run
                          {r._count.benchmarkRuns === 1 ? "" : "s"}
                        </span>
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
