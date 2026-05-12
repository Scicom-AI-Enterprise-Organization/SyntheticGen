import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RunLiveStatus } from "./run-live-status";
import { CancelRunButton } from "./cancel-run-button";
import { LiveJobPreview } from "./live-job-preview";
import { JumpstartJobButton } from "./jumpstart-job-button";
import { RegenRunButton } from "./regen-run-button";

const JOB_PAGE_SIZE = 50;
const JOB_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "outline",
  running: "secondary",
  succeeded: "default",
  failed: "destructive",
  skipped: "outline",
};
const JOB_STATUS_FILTERS = [
  "all",
  "succeeded",
  "failed",
  "running",
  "pending",
  "skipped",
] as const;
type JobStatusFilter = (typeof JOB_STATUS_FILTERS)[number];

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId, runId } = await params;
  const sp = await searchParams;
  const { role } = await requireProjectPermission(projectId, "runs.read");
  const canCancel = role ? projectRoleAllows(role, "runs.cancel") : false;
  const canExecute = role ? projectRoleAllows(role, "runs.execute") : false;

  const jobStatusFilter: JobStatusFilter =
    (JOB_STATUS_FILTERS as readonly string[]).includes(
      (sp.jobStatus as string) ?? "",
    )
      ? (sp.jobStatus as JobStatusFilter)
      : "all";
  const jobPage = Math.max(
    0,
    Number(Array.isArray(sp.jobsPage) ? sp.jobsPage[0] : sp.jobsPage) || 0,
  );

  const jobWhere = {
    runId,
    ...(jobStatusFilter !== "all" ? { status: jobStatusFilter } : {}),
  };

  const [run, jobsByStatus, jobs, jobsTotal] = await Promise.all([
    prisma.generationRun.findUnique({
      where: { id: runId },
      include: {
        template: { select: { name: true } },
        languageProfile: { select: { name: true, register: true, allowParticles: true } },
        providerCredential: { select: { name: true, kind: true } },
      },
    }),
    prisma.generationJob.groupBy({
      by: ["status"],
      where: { runId },
      _count: { _all: true },
    }),
    prisma.generationJob.findMany({
      where: jobWhere,
      // Finished jobs first (most recent), then pending/running by creation.
      orderBy: [{ finishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
      skip: jobPage * JOB_PAGE_SIZE,
      take: JOB_PAGE_SIZE,
      select: {
        id: true,
        cellKey: true,
        status: true,
        attempts: true,
        conversationId: true,
        tokensIn: true,
        tokensOut: true,
        latencyMs: true,
        startedAt: true,
        finishedAt: true,
        lastError: true,
      },
    }),
    prisma.generationJob.count({ where: jobWhere }),
  ]);
  if (!run || run.projectId !== projectId) notFound();

  const counts = Object.fromEntries(jobsByStatus.map((j) => [j.status, j._count._all]));

  // Self-heal a run whose jobs all finished but whose status never got flipped
  // (happens when jobs were dispatched via the fire-and-forget path before the
  // completion hook landed). One-shot UPDATE, then patch the in-memory run so
  // the rest of the render sees the new status without a second fetch.
  if (run.status === "running" || run.status === "queued") {
    const livePending =
      (counts["pending"] ?? 0) + (counts["queued"] ?? 0) + (counts["running"] ?? 0);
    if (livePending === 0 && (counts["succeeded"] ?? 0) + (counts["failed"] ?? 0) + (counts["cancelled"] ?? 0) + (counts["skipped"] ?? 0) > 0) {
      await prisma.generationRun.update({
        where: { id: runId },
        data: { status: "completed", completedAt: new Date() },
      });
      run.status = "completed";
      run.completedAt = new Date();
    }
  }
  const jobTotalPages = Math.max(1, Math.ceil(jobsTotal / JOB_PAGE_SIZE));
  const jobShowingFrom = jobsTotal === 0 ? 0 : jobPage * JOB_PAGE_SIZE + 1;
  const jobShowingTo = Math.min(jobsTotal, jobPage * JOB_PAGE_SIZE + jobs.length);

  const basePath = `/projects/${projectId}/runs/${runId}`;
  function jobsHref(next: { jobStatus?: JobStatusFilter; jobsPage?: number }): string {
    const q = new URLSearchParams();
    const s = next.jobStatus ?? jobStatusFilter;
    const p = next.jobsPage ?? jobPage;
    if (s !== "all") q.set("jobStatus", s);
    if (p > 0) q.set("jobsPage", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{run.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {run.template?.name ?? "—"} · {run.model} · profile {run.languageProfile?.name ?? "—"}
            {run.formalityPolicy !== "inherit" && (
              <Badge variant="default" className="ml-2 text-[10px]">
                lock: {run.formalityPolicy}
              </Badge>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          {canExecute && (
            <RegenRunButton
              projectId={projectId}
              runId={runId}
              totalJobs={jobsTotal}
              succeededJobs={counts["succeeded"] ?? 0}
            />
          )}
          {canCancel && (run.status === "queued" || run.status === "running") && (
            <CancelRunButton projectId={projectId} runId={runId} />
          )}
        </div>
      </div>

      <RunLiveStatus
        projectId={projectId}
        runId={runId}
        initial={{
          status: run.status,
          producedCount: run.producedCount,
          targetCount: run.targetCount,
          acceptedCount: run.acceptedCount,
          tokensIn: Number(run.tokensIn),
          tokensOut: Number(run.tokensOut),
          costUsd: run.costUsd ? Number(run.costUsd) : 0,
          counts: {
            pending: counts["pending"] ?? 0,
            running: counts["running"] ?? 0,
            succeeded: counts["succeeded"] ?? 0,
            failed: counts["failed"] ?? 0,
            skipped: counts["skipped"] ?? 0,
          },
        }}
      />

      {(run.status === "running" || run.status === "queued") && (
        <LiveJobPreview projectId={projectId} runId={runId} />
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>Jobs ({jobsTotal})</CardTitle>
            <CardDescription>
              {jobsTotal === 0
                ? "No jobs match the current filter."
                : `Showing ${jobShowingFrom}–${jobShowingTo} of ${jobsTotal}. ` +
                  "Succeeded jobs link to their generated conversation."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1">
            {JOB_STATUS_FILTERS.map((s) => {
              const count = s === "all" ? undefined : counts[s] ?? 0;
              const active = jobStatusFilter === s;
              return (
                <Button
                  key={s}
                  asChild
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-[11px]"
                >
                  <Link href={jobsHref({ jobStatus: s, jobsPage: 0 })} scroll={false}>
                    {s}
                    {count !== undefined && (
                      <span className="ml-1 opacity-70">({count})</span>
                    )}
                  </Link>
                </Button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs to show.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Cell</th>
                      <th className="py-2 pr-4 font-medium">Attempts</th>
                      <th className="py-2 pr-4 font-medium">Tokens (in/out)</th>
                      <th className="py-2 pr-4 font-medium">Latency</th>
                      <th className="py-2 pr-4 font-medium">Finished</th>
                      <th className="py-2 pl-4 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id} className="border-b border-border/50 align-top">
                        <td className="py-3 pr-4">
                          <Badge
                            variant={JOB_STATUS_VARIANT[j.status] ?? "outline"}
                            className="text-[10px]"
                          >
                            {j.status}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 font-mono text-[10px] text-muted-foreground">
                          <span title={j.cellKey}>{shortCell(j.cellKey)}</span>
                          {j.lastError && (
                            <div className="mt-1 max-w-[420px] whitespace-pre-wrap break-words text-[10px] text-destructive">
                              {j.lastError.slice(0, 200)}
                              {j.lastError.length > 200 && "…"}
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-xs">{j.attempts}</td>
                        <td className="py-3 pr-4 text-xs">
                          {j.tokensIn}/{j.tokensOut}
                        </td>
                        <td className="py-3 pr-4 text-xs">
                          {j.latencyMs != null ? `${j.latencyMs} ms` : "—"}
                        </td>
                        <td
                          className="py-3 pr-4 text-xs text-muted-foreground"
                          title={j.finishedAt?.toISOString()}
                        >
                          {j.finishedAt ? j.finishedAt.toLocaleString() : "—"}
                        </td>
                        <td className="py-3 pl-4 text-right">
                          <div className="flex justify-end gap-1">
                            {j.conversationId ? (
                              <Button
                                asChild
                                variant="ghost"
                                size="icon"
                                aria-label="View conversation"
                                title="View generated conversation"
                              >
                                <Link
                                  href={`/projects/${projectId}/conversations?focus=${j.conversationId}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Link>
                              </Button>
                            ) : null}
                            {canExecute &&
                              j.status !== "running" &&
                              j.status !== "pending" && (
                                <JumpstartJobButton
                                  projectId={projectId}
                                  runId={run.id}
                                  jobId={j.id}
                                  status={j.status}
                                  attempts={j.attempts}
                                  iconOnly
                                />
                              )}
                            {!j.conversationId &&
                              !(
                                canExecute &&
                                j.status !== "running" &&
                                j.status !== "pending"
                              ) && (
                                <span className="text-[11px] text-muted-foreground">—</span>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <div>
                  Page {jobPage + 1} of {jobTotalPages}
                </div>
                <div className="flex items-center gap-2">
                  {jobPage <= 0 ? (
                    <Button variant="outline" size="sm" disabled>
                      <ChevronLeft className="mr-1 h-3 w-3" />
                      Prev
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={jobsHref({ jobsPage: jobPage - 1 })}
                        scroll={false}
                      >
                        <ChevronLeft className="mr-1 h-3 w-3" />
                        Prev
                      </Link>
                    </Button>
                  )}
                  {jobPage + 1 >= jobTotalPages ? (
                    <Button variant="outline" size="sm" disabled>
                      Next
                      <ChevronRight className="ml-1 h-3 w-3" />
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={jobsHref({ jobsPage: jobPage + 1 })}
                        scroll={false}
                      >
                        Next
                        <ChevronRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration snapshot</CardTitle>
          <CardDescription>Frozen at run start.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-[11px] leading-snug">
            {JSON.stringify(run.configSnapshot, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

// `t:<id>|p:<id>|d:hard|i:7` or `f:<id>|p:<id>|d:hard|i:7` — shorten ids in
// each segment to keep the table readable.
function shortCell(cellKey: string): string {
  return cellKey
    .split("|")
    .map((seg) => {
      const ix = seg.indexOf(":");
      if (ix < 0) return seg;
      const k = seg.slice(0, ix);
      const v = seg.slice(ix + 1);
      if (v.length > 12) return `${k}:${v.slice(0, 8)}…`;
      return seg;
    })
    .join(" · ");
}
