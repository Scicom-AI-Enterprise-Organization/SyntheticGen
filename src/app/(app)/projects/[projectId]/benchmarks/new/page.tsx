import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { CreateBenchmarkForm } from "../create-benchmark-form";

export default async function NewBenchmarkPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "benchmarks.write");

  const [runs, rubrics] = await Promise.all([
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
    prisma.rubric.findMany({
      where: { projectId },
      orderBy: [{ isPreset: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isPreset: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New benchmark</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/benchmarks`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to benchmarks
          </Link>
        </Button>
      </div>
      <CreateBenchmarkForm
        projectId={projectId}
        runs={runs.map((r) => ({
          id: r.id,
          name: r.name,
          model: r.model,
          acceptedCount: r.acceptedCount,
          createdAt: r.createdAt.toISOString(),
        }))}
        rubrics={rubrics}
        card={{
          title: "Benchmark",
          description:
            "Freeze a slice of project-generated conversations as the eval set. Each run replays the recorded user turns through a candidate model and the rubric-driven LLM judge scores it against the original assistant turns.",
        }}
      />
    </div>
  );
}
