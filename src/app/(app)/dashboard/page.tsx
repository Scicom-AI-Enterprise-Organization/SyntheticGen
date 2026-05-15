import Link from "next/link";
import {
  ArrowRight,
  Database,
  FolderKanban,
  MessagesSquare,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { HorizontalBars } from "@/components/charts/horizontal-bars";

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildDailySeries(
  rows: { day: Date; count: number }[],
  days: number,
): { label: string; value: number; hint: string }[] {
  // Build a contiguous N-day window ending today, filling missing days with zero.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: { label: string; value: number; hint: string }[] = [];
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = new Date(r.day).toISOString().slice(0, 10);
    map.set(key, Number(r.count));
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const value = map.get(key) ?? 0;
    out.push({
      label: DAY_NAMES_SHORT[d.getDay()],
      value,
      hint: `${d.toLocaleDateString()}: ${value}`,
    });
  }
  return out;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  queued: "secondary",
  running: "default",
  paused: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

export default async function DashboardPage() {
  const user = await requireUser();
  const isGlobalAdmin =
    user.permissions.includes("users:write") &&
    user.permissions.includes("roles:write");

  // Scope by membership (global admins see everything).
  const projectScope = isGlobalAdmin
    ? {}
    : { project: { members: { some: { userId: user.id } } } };

  // Resolve the set of project ids the user can see; reused by chart queries
  // because Prisma's groupBy doesn't let us join through `project.members`.
  const visibleProjects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      ...(isGlobalAdmin ? {} : { members: { some: { userId: user.id } } }),
    },
    select: { id: true, name: true },
  });
  const visibleProjectIds = visibleProjects.map((p) => p.id);
  const projectIdFilter: Prisma.StringFilter | undefined =
    visibleProjectIds.length > 0 ? { in: visibleProjectIds } : undefined;
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setHours(0, 0, 0, 0);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);

  const [
    runCounts,
    convoCounts,
    recentRuns,
    recentConvos,
    datasetCount,
    dailyConvoRows,
    languageRows,
    perProjectRows,
    validationFailRows,
  ] = await Promise.all([
    prisma.generationRun.groupBy({
      by: ["status"],
      where: { ...projectScope },
      _count: { _all: true },
    }),
    prisma.conversation.groupBy({
      by: ["status"],
      where: { ...projectScope },
      _count: { _all: true },
    }),
    prisma.generationRun.findMany({
      where: { ...projectScope },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        producedCount: true,
        targetCount: true,
        projectId: true,
        project: { select: { name: true } },
      },
    }),
    prisma.conversation.findMany({
      where: { ...projectScope },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        primaryLanguage: true,
        turnCount: true,
        projectId: true,
        project: { select: { name: true } },
      },
    }),
    prisma.dataset.count({ where: { ...projectScope } }),
    // Daily conversation counts. Empty visible set short-circuits to [].
    projectIdFilter
      ? prisma.$queryRaw<{ day: Date; count: bigint }[]>(Prisma.sql`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
          FROM "Conversation"
          WHERE "projectId" = ANY(${visibleProjectIds}::text[])
            AND "createdAt" >= ${fourteenDaysAgo}
          GROUP BY 1
          ORDER BY 1
        `)
      : Promise.resolve([]),
    prisma.conversation.groupBy({
      by: ["primaryLanguage"],
      where: { ...projectScope, primaryLanguage: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { primaryLanguage: "desc" } },
      take: 10,
    }),
    prisma.conversation.groupBy({
      by: ["projectId"],
      where: { ...projectScope },
      _count: { _all: true },
      orderBy: { _count: { projectId: "desc" } },
      take: 6,
    }),
    prisma.validation.groupBy({
      by: ["axis"],
      where: { verdict: "fail", conversation: { ...projectScope } },
      _count: { _all: true },
      orderBy: { _count: { axis: "desc" } },
      take: 6,
    }),
  ]);

  const projectCount = visibleProjects.length;

  const totalRuns = runCounts.reduce((s, r) => s + r._count._all, 0);
  const activeRuns =
    (runCounts.find((r) => r.status === "running")?._count._all ?? 0) +
    (runCounts.find((r) => r.status === "queued")?._count._all ?? 0);
  const totalConvos = convoCounts.reduce((s, r) => s + r._count._all, 0);
  const acceptedConvos = convoCounts.find((r) => r.status === "accepted")?._count._all ?? 0;
  const rejectedConvos = convoCounts.find((r) => r.status === "rejected")?._count._all ?? 0;
  const generatedConvos =
    convoCounts.find((r) => r.status === "generated")?._count._all ?? 0;
  const flaggedConvos = convoCounts.find((r) => r.status === "flagged")?._count._all ?? 0;
  const acceptanceRate =
    totalConvos > 0 ? Math.round((acceptedConvos / totalConvos) * 100) : 0;

  // ---- chart-shape transforms ----
  const dailyConvoData = buildDailySeries(
    dailyConvoRows.map((r) => ({ day: r.day, count: Number(r.count) })),
    14,
  );

  const acceptanceDonutData = [
    { label: "Accepted", value: acceptedConvos, colorVar: "chart-3" },
    { label: "Rejected", value: rejectedConvos, colorVar: "chart-1" },
    { label: "Flagged", value: flaggedConvos, colorVar: "chart-4" },
    { label: "Generated", value: generatedConvos, colorVar: "chart-5" },
  ].filter((d) => d.value > 0);

  const languageData = languageRows
    .filter((r) => r.primaryLanguage)
    .map((r) => ({
      label: r.primaryLanguage as string,
      value: r._count._all,
    }));

  const projectNameById = new Map(visibleProjects.map((p) => [p.id, p.name]));
  const topProjectData = perProjectRows.map((r) => ({
    label: projectNameById.get(r.projectId) ?? r.projectId.slice(0, 8),
    value: r._count._all,
  }));

  const validationFailData = validationFailRows.map((r) => ({
    label: r.axis,
    value: r._count._all,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome{user.name ? `, ${user.name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {projectCount === 0
              ? "Create your first project to start generating localized synthetic datasets."
              : `Across ${projectCount} project${projectCount === 1 ? "" : "s"}.`}
          </p>
        </div>
        <Button asChild>
          <Link href="/projects">
            <FolderKanban className="mr-2 h-4 w-4" />
            All projects
          </Link>
        </Button>
      </div>

      {projectCount > 0 && totalConvos > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Conversations — last 14 days</CardTitle>
              <CardDescription>
                Daily generated samples across {projectCount} project
                {projectCount === 1 ? "" : "s"}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart data={dailyConvoData} height={120} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acceptance breakdown</CardTitle>
              <CardDescription>{acceptanceRate}% accepted overall.</CardDescription>
            </CardHeader>
            <CardContent>
              <DonutChart
                data={acceptanceDonutData}
                size={140}
                centerLabel={`${acceptanceRate}%`}
                centerHint="accepted"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Languages</CardTitle>
              <CardDescription>Detected primary language by lang-ID.</CardDescription>
            </CardHeader>
            <CardContent>
              <HorizontalBars data={languageData} emptyText="No language data yet." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top projects</CardTitle>
              <CardDescription>By conversation count.</CardDescription>
            </CardHeader>
            <CardContent>
              <HorizontalBars data={topProjectData} emptyText="No conversations yet." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Validation fails by axis</CardTitle>
              <CardDescription>
                What&apos;s tripping the validators most often.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HorizontalBars data={validationFailData} emptyText="No fails recorded — clean!" />
            </CardContent>
          </Card>
        </div>
      )}

      {projectCount === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Get started
            </CardTitle>
            <CardDescription>
              Each project ships with two seeded language profiles you can edit or replace:
              an Enterprise Formal preset (formality-locked, banned-token enforced) and a
              Casual preset (relaxed register, code-switching allowed).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/projects">
                Create a project <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={FolderKanban}
              label="Projects"
              value={projectCount}
              href="/projects"
            />
            <Stat
              icon={Play}
              label="Runs"
              value={totalRuns}
              hint={activeRuns > 0 ? `${activeRuns} active` : undefined}
            />
            <Stat
              icon={MessagesSquare}
              label="Conversations"
              value={totalConvos}
              hint={
                totalConvos > 0
                  ? `${acceptanceRate}% accepted (${acceptedConvos} ✓ / ${rejectedConvos} ✗)`
                  : undefined
              }
            />
            <Stat icon={Database} label="Datasets" value={datasetCount} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent runs</CardTitle>
                <CardDescription>Last 5 across your projects.</CardDescription>
              </CardHeader>
              <CardContent>
                {recentRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No runs yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {recentRuns.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <Link
                          href={`/projects/${r.projectId}/runs/${r.id}`}
                          className="min-w-0 flex-1 truncate hover:underline"
                        >
                          <span className="font-medium">{r.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {r.project.name}
                          </span>
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {r.producedCount}/{r.targetCount}
                        </span>
                        <Badge
                          variant={STATUS_VARIANT[r.status] ?? "outline"}
                          className="shrink-0 text-[10px]"
                        >
                          {r.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent conversations</CardTitle>
                <CardDescription>Last 5 generated samples.</CardDescription>
              </CardHeader>
              <CardContent>
                {recentConvos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No conversations yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {recentConvos.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <Link
                          href={`/projects/${c.projectId}/conversations?focus=${c.id}`}
                          className="min-w-0 flex-1 truncate hover:underline"
                        >
                          <span className="font-mono text-xs">{c.id.slice(0, 10)}…</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {c.project.name}
                          </span>
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {c.turnCount} turn{c.turnCount === 1 ? "" : "s"}
                        </span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {c.primaryLanguage ?? "—"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {isGlobalAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              Admin
            </CardTitle>
            <CardDescription>You have global admin access.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/organization">Users & invitations</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/roles">Roles</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {href && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="mt-3 text-2xl font-semibold">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="transition-colors hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}
