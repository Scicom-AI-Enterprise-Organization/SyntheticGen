import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Eye } from "lucide-react";
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
import { ClickableJobRow } from "./clickable-job-row";

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

  // Sortable columns. Whitelist the keys we expose so query-string can't
  // smuggle arbitrary Prisma orderBy fields.
  const SORT_FIELDS = [
    "attempts",
    "tokensIn",
    "tokensOut",
    "latencyMs",
    "finishedAt",
  ] as const;
  type SortField = (typeof SORT_FIELDS)[number];
  const jobSort: SortField =
    (SORT_FIELDS as readonly string[]).includes((sp.jobSort as string) ?? "")
      ? (sp.jobSort as SortField)
      : "finishedAt";
  const jobDir: "asc" | "desc" = sp.jobDir === "asc" ? "asc" : "desc";

  const jobWhere = {
    runId,
    ...(jobStatusFilter !== "all" ? { status: jobStatusFilter } : {}),
  };

  const [run, jobsByStatus, jobs, jobsTotal] = await Promise.all([
    prisma.generationRun.findUnique({
      where: { id: runId },
      include: {
        template: { select: { name: true, kind: true } },
        languageProfile: { select: { name: true, register: true, allowParticles: true, primary: true } },
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
      // Honor the chosen sort field + direction. Nulls sort last so pending
      // jobs with finishedAt=NULL stay at the bottom. Tie-break by createdAt
      // for stable ordering.
      orderBy: [
        { [jobSort]: { sort: jobDir, nulls: "last" } },
        { createdAt: "asc" },
      ],
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

  // Resolve every id inside configSnapshot to human-readable names for the
  // Settings card. configSnapshot is frozen JSON so we can't navigate it via
  // Prisma relations — one lookup per id-array does the job.
  const cfg = (run.configSnapshot ?? {}) as Record<string, unknown>;
  const grid = (cfg.grid ?? {}) as Record<string, unknown>;
  const cfgToolIds = pickStringArray(cfg.toolIds);
  const cfgFlowIds = pickStringArray(cfg.flowIds);
  const cfgNodeIds = pickStringArray(grid.taxonomyNodeIds);
  const cfgPersonaIds = pickStringArray(grid.personaIds);
  const cfgDifficulties = pickStringArray(grid.difficulties);
  const cfgRowsPerCell = typeof grid.rowsPerCell === "number" ? grid.rowsPerCell : null;
  const cfgSampling = (cfg.samplingParams ?? {}) as Record<string, unknown>;

  const [toolDefs, flowDefs, taxonomyNodes, personaDefs] = await Promise.all([
    cfgToolIds.length > 0
      ? prisma.toolDef.findMany({
          where: { id: { in: cfgToolIds } },
          select: { id: true, name: true },
        })
      : [],
    cfgFlowIds.length > 0
      ? prisma.flow.findMany({
          where: { id: { in: cfgFlowIds } },
          select: { id: true, name: true, version: true },
        })
      : [],
    cfgNodeIds.length > 0
      ? prisma.taxonomyNode.findMany({
          where: { id: { in: cfgNodeIds } },
          select: { id: true, name: true, path: true },
        })
      : [],
    cfgPersonaIds.length > 0
      ? prisma.persona.findMany({
          where: { id: { in: cfgPersonaIds } },
          select: { id: true, name: true, formality: true },
        })
      : [],
  ]);

  const toolNames = toolDefs.map((t) => t.name);
  const flowLabels = flowDefs.map((f) => `${f.name} v${f.version}`);
  const taxonomyLabels = taxonomyNodes.map(
    (n) => `${n.name}${n.path ? ` (${n.path})` : ""}`,
  );
  const personaLabels = personaDefs.map(
    (p) => `${p.name}${p.formality ? ` (${p.formality})` : ""}`,
  );

  // For legacy runs that still recorded `difficulties` in their gridSpec, keep
  // the dimension in the totalCells math so the recap matches what the worker
  // actually materialized.
  const totalCells =
    (cfgFlowIds.length > 0 ? cfgFlowIds.length : cfgNodeIds.length) *
    Math.max(1, cfgPersonaIds.length) *
    Math.max(1, cfgDifficulties.length) *
    Math.max(1, cfgRowsPerCell ?? 1);

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
  function jobsHref(next: {
    jobStatus?: JobStatusFilter;
    jobsPage?: number;
    jobSort?: SortField;
    jobDir?: "asc" | "desc";
  }): string {
    const q = new URLSearchParams();
    const s = next.jobStatus ?? jobStatusFilter;
    const p = next.jobsPage ?? jobPage;
    const so = next.jobSort ?? jobSort;
    const d = next.jobDir ?? jobDir;
    if (s !== "all") q.set("jobStatus", s);
    if (p > 0) q.set("jobsPage", String(p));
    if (so !== "finishedAt") q.set("jobSort", so);
    if (d !== "desc") q.set("jobDir", d);
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  // Builds the URL for opening a job's saved stream in the Live Job Preview
  // card. Preserves all current jobs-table filters, paging, and sort state
  // so the user can come back to the same view by hitting Back.
  //
  // NOTE: deliberately NO hash anchor. The browser natively scrolls to a hash
  // target on every navigation, even with Next's `scroll={false}` on the
  // Link — that made the page yank up to the preview card on every click,
  // pulling the user away from the jobs table they were clicking from.
  // Selection now happens in place; the user keeps their scroll position.
  function previewHref(jobId: string): string {
    const q = new URLSearchParams();
    if (jobStatusFilter !== "all") q.set("jobStatus", jobStatusFilter);
    if (jobPage > 0) q.set("jobsPage", String(jobPage));
    if (jobSort !== "finishedAt") q.set("jobSort", jobSort);
    if (jobDir !== "desc") q.set("jobDir", jobDir);
    q.set("previewJob", jobId);
    return `${basePath}?${q.toString()}`;
  }

  // Builds the URL for clicking a sortable column header. Same column → flip
  // direction. New column → start at desc.
  function sortHref(field: SortField): string {
    const sameField = jobSort === field;
    return jobsHref({
      jobSort: field,
      jobDir: sameField ? (jobDir === "desc" ? "asc" : "desc") : "desc",
      jobsPage: 0,
    });
  }

  const progressActions = (
    <>
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
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{run.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {run.template?.name ?? "—"} · {run.model} · profile {run.languageProfile?.name ?? "—"}
            {run.formalityPolicy !== "inherit" && (
              <Badge variant="default" className="ml-2 text-[10px]">
                lock: {run.formalityPolicy}
              </Badge>
            )}
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/runs`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to runs
          </Link>
        </Button>
      </div>

      <RunLiveStatus
        projectId={projectId}
        runId={runId}
        headerActions={progressActions}
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

      {/* Always render — when there are no running jobs, the preview replays
          saved tokens for whichever past job the user picks. */}
      <section id="live-job-preview" className="scroll-mt-4">
        <LiveJobPreview projectId={projectId} runId={runId} />
      </section>

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
                      <SortHeader label="Attempts" field="attempts" jobSort={jobSort} jobDir={jobDir} hrefFor={sortHref} />
                      <SortHeader label="Tokens in" field="tokensIn" jobSort={jobSort} jobDir={jobDir} hrefFor={sortHref} />
                      <SortHeader label="Tokens out" field="tokensOut" jobSort={jobSort} jobDir={jobDir} hrefFor={sortHref} />
                      <SortHeader label="Latency" field="latencyMs" jobSort={jobSort} jobDir={jobDir} hrefFor={sortHref} />
                      <SortHeader label="Finished" field="finishedAt" jobSort={jobSort} jobDir={jobDir} hrefFor={sortHref} />
                      <th className="py-2 pl-4 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <ClickableJobRow
                        key={j.id}
                        href={previewHref(j.id)}
                        className="cursor-pointer border-b border-border/50 align-top hover:bg-muted/40"
                      >
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
                        <td className="py-3 pr-4 font-mono text-xs">{j.tokensIn}</td>
                        <td className="py-3 pr-4 font-mono text-xs">{j.tokensOut}</td>
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
                      </ClickableJobRow>
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
        <CardContent className="space-y-4">
          <KV
            rows={[
              ["mode", cfgFlowIds.length > 0 ? "flow-driven" : "single-turn"],
              ["model", run.model],
              [
                "provider",
                run.providerCredential
                  ? `${run.providerCredential.name} (${run.providerCredential.kind})`
                  : null,
              ],
              [
                "template",
                run.template ? `${run.template.name} (${run.template.kind})` : null,
              ],
              [
                "language profile",
                run.languageProfile
                  ? `${run.languageProfile.name} · ${run.languageProfile.primary} · ${run.languageProfile.register}${
                      run.languageProfile.allowParticles ? " · particles ok" : " · no particles"
                    }`
                  : null,
              ],
              ["formality lock", run.formalityPolicy],
              ["taxonomy nodes", listOrDash(taxonomyLabels)],
              ["personas", listOrDash(personaLabels)],
              // Legacy field — newer runs leave this empty. KV drops null rows.
              ["difficulties", listOrDash(cfgDifficulties)],
              ["conversations per combination", cfgRowsPerCell?.toString() ?? null],
              ["flows", listOrDash(flowLabels)],
              ["tools", listOrDash(toolNames)],
              [
                "sampling",
                [
                  cfgSampling.temperature != null && `temp=${cfgSampling.temperature}`,
                  cfgSampling.top_p != null && `top_p=${cfgSampling.top_p}`,
                  cfgSampling.max_tokens != null && `max=${cfgSampling.max_tokens}`,
                  cfgSampling.seed != null && `seed=${cfgSampling.seed}`,
                  cfgSampling.turns != null && `turns=${cfgSampling.turns}`,
                  cfgSampling.relatedTopics != null &&
                    Number(cfgSampling.relatedTopics) > 0 &&
                    `relatedTopics=${cfgSampling.relatedTopics}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || null,
              ],
              [
                "total cells",
                `${totalCells} (${
                  cfgFlowIds.length > 0 ? "flows" : "nodes"
                } × personas${
                  cfgDifficulties.length > 0 ? " × difficulties" : ""
                } × conversations-per-combination)`,
              ],
            ]}
          />

          <details className="rounded-md border border-border bg-muted/20">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">
              Raw JSON
            </summary>
            <pre className="overflow-x-auto border-t border-border bg-muted/40 p-3 text-[11px] leading-snug">
              {JSON.stringify(run.configSnapshot, null, 2)}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

function pickStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function listOrDash(items: string[]): string | null {
  if (items.length === 0) return null;
  return items.join(", ");
}

function KV({ rows }: { rows: Array<[string, string | null]> }) {
  const filtered = rows.filter(([, v]) => v !== null && v !== "" && v !== "null");
  if (filtered.length === 0) {
    return <p className="text-xs text-muted-foreground">No settings recorded.</p>;
  }
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-xs">
      {filtered.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// Clickable column header that toggles asc/desc when the same column is
// chosen again, or starts at desc when switching to a different column.
function SortHeader({
  label,
  field,
  jobSort,
  jobDir,
  hrefFor,
}: {
  label: string;
  field: "attempts" | "tokensIn" | "tokensOut" | "latencyMs" | "finishedAt";
  jobSort: string;
  jobDir: "asc" | "desc";
  hrefFor: (f: "attempts" | "tokensIn" | "tokensOut" | "latencyMs" | "finishedAt") => string;
}) {
  const active = jobSort === field;
  const Icon = active ? (jobDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className="py-2 pr-4 font-medium">
      <Link
        href={hrefFor(field)}
        scroll={false}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
        title={active ? `Sorted ${jobDir}ending` : "Click to sort"}
      >
        {label}
        <Icon className="h-3 w-3 opacity-70" />
      </Link>
    </th>
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
