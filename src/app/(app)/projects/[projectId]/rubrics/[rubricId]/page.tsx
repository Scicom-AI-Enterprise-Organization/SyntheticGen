import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
import { RubricForm, type RubricAxis } from "../rubric-form";
import { DeleteRubricButton } from "./delete-rubric-button";

export default async function RubricDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; rubricId: string }>;
}) {
  const { projectId, rubricId } = await params;
  const { role } = await requireProjectPermission(projectId, "benchmarks.read");
  const canWrite = role ? projectRoleAllows(role, "benchmarks.write") : false;

  const [rubric, providers] = await Promise.all([
    prisma.rubric.findFirst({
      where: { id: rubricId, projectId },
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

  if (!rubric) notFound();

  const axes = (Array.isArray(rubric.axes) ? rubric.axes : []) as unknown as RubricAxis[];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/rubrics`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Rubrics
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{rubric.name}</h1>
          {rubric.isPreset && <Badge variant="outline">preset</Badge>}
          {rubric.aiDrafted && <Badge variant="secondary">AI-drafted</Badge>}
        </div>
        {rubric.description && (
          <p className="mt-1 text-sm text-muted-foreground">{rubric.description}</p>
        )}
        <div className="mt-1 text-xs text-muted-foreground">
          Used by {rubric._count.benchmarks} benchmark
          {rubric._count.benchmarks === 1 ? "" : "s"} ·{" "}
          {rubric._count.benchmarkRuns} run{rubric._count.benchmarkRuns === 1 ? "" : "s"}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{canWrite && !rubric.isPreset ? "Edit rubric" : "Rubric definition"}</CardTitle>
          <CardDescription>
            {rubric.isPreset
              ? "This is a system preset — clone it to make edits."
              : "Adjust axes, weights, and descriptions. The judge sees each axis description verbatim."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canWrite && !rubric.isPreset ? (
            <RubricForm
              projectId={projectId}
              providers={providers}
              initial={{
                id: rubric.id,
                name: rubric.name,
                description: rubric.description,
                axes,
              }}
            />
          ) : (
            <ReadOnlyRubric axes={axes} />
          )}
        </CardContent>
      </Card>

      {canWrite && !rubric.isPreset && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Deleting a rubric leaves existing benchmark runs with their snapshotted scoring
              intact, but new runs that referenced this rubric will fall back to the benchmark
              default (or fail if none).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteRubricButton projectId={projectId} rubricId={rubric.id} name={rubric.name} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReadOnlyRubric({ axes }: { axes: RubricAxis[] }) {
  return (
    <div className="space-y-3">
      {axes.map((axis, i) => (
        <div key={i} className="rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{axis.name}</span>
              <code className="font-mono text-xs text-muted-foreground">{axis.key}</code>
            </div>
            <div className="text-[11px] text-muted-foreground">
              scale 1–{axis.scale} · weight {axis.weight}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{axis.description}</p>
          {axis.examples && axis.examples.length > 0 && (
            <details className="mt-2 rounded border border-border/60 bg-muted/20">
              <summary className="cursor-pointer select-none px-2 py-1 text-[10px] text-muted-foreground">
                {axis.examples.length} example{axis.examples.length === 1 ? "" : "s"}
              </summary>
              <div className="space-y-1 border-t border-border/60 px-2 py-2 text-[10px]">
                {axis.examples.map((ex, j) => (
                  <div key={j} className="rounded border border-border/40 bg-background/60 p-1.5">
                    <div className="mb-0.5 flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-[9px]">
                        score: {ex.score}
                      </Badge>
                      {ex.reason && (
                        <span className="italic text-muted-foreground">{ex.reason}</span>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono leading-snug">
                      {ex.output}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
