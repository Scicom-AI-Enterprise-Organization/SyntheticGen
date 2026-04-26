import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  queued: "secondary",
  running: "default",
  paused: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

export default async function RunsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "runs.read");
  const canExecute = role ? projectRoleAllows(role, "runs.execute") : false;

  const runs = await prisma.generationRun.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { template: { select: { name: true } }, languageProfile: { select: { name: true } } },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Generation runs. Each run snapshots its config; cancel any time.
          </p>
        </div>
        {canExecute && (
          <Button asChild>
            <Link href={`/projects/${projectId}/runs/new`}>
              <Plus className="mr-2 h-4 w-4" />
              New run
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs ({runs.length})</CardTitle>
          <CardDescription>Last 50.</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Model</th>
                    <th className="py-2 pr-4 font-medium">Profile</th>
                    <th className="py-2 pr-4 font-medium">Progress</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-3 pr-4">
                        <Link
                          href={`/projects/${projectId}/runs/${r.id}`}
                          className="font-medium hover:underline"
                        >
                          {r.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {r.template?.name ?? "—"}
                        </div>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">{r.model}</td>
                      <td className="py-3 pr-4 text-xs">{r.languageProfile?.name ?? "—"}</td>
                      <td className="py-3 pr-4 text-xs">
                        {r.producedCount} / {r.targetCount}
                        <span className="ml-2 text-muted-foreground">
                          ({r.acceptedCount} ok)
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-[10px]">
                          {r.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
