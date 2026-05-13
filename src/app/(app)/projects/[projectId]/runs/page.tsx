import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
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

const PAGE_SIZE = 25;
type SortField = "createdAt" | "updatedAt";
type SortDir = "asc" | "desc";

export default async function RunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const { role } = await requireProjectPermission(projectId, "runs.read");
  const canExecute = role ? projectRoleAllows(role, "runs.execute") : false;

  const sort: SortField = sp.sort === "updatedAt" ? "updatedAt" : "createdAt";
  const dir: SortDir = sp.dir === "asc" ? "asc" : "desc";
  const page = Math.max(0, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 0);

  const [runs, total] = await Promise.all([
    prisma.generationRun.findMany({
      where: { projectId },
      orderBy: { [sort]: dir },
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { template: { select: { name: true } }, languageProfile: { select: { name: true } } },
    }),
    prisma.generationRun.count({ where: { projectId } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(total, page * PAGE_SIZE + runs.length);

  const basePath = `/projects/${projectId}/runs`;
  function hrefWith(next: { sort?: SortField; dir?: SortDir; page?: number }): string {
    const q = new URLSearchParams();
    const s = next.sort ?? sort;
    const d = next.dir ?? dir;
    const p = next.page ?? page;
    if (s !== "createdAt") q.set("sort", s);
    if (d !== "desc") q.set("dir", d);
    if (p > 0) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  // Toggle direction when clicking the active column; switch column otherwise.
  function sortHref(field: SortField): string {
    if (field === sort) {
      return hrefWith({ dir: dir === "desc" ? "asc" : "desc", page: 0 });
    }
    return hrefWith({ sort: field, dir: "desc", page: 0 });
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sort !== field) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    return dir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
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
          <CardTitle>Runs ({total})</CardTitle>
          <CardDescription>
            {total === 0
              ? "No runs yet."
              : `Showing ${showingFrom}–${showingTo} of ${total}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">
                        <Link
                          href={sortHref("createdAt")}
                          className="inline-flex items-center hover:text-foreground"
                          scroll={false}
                        >
                          Created
                          <SortIcon field="createdAt" />
                        </Link>
                      </th>
                      <th className="py-2 pr-4 font-medium">
                        <Link
                          href={sortHref("updatedAt")}
                          className="inline-flex items-center hover:text-foreground"
                          scroll={false}
                        >
                          Updated
                          <SortIcon field="updatedAt" />
                        </Link>
                      </th>
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
                        <td className="py-3 pr-4 text-xs text-muted-foreground" title={r.createdAt.toISOString()}>
                          {formatTimestamp(r.createdAt)}
                        </td>
                        <td className="py-3 pr-4 text-xs text-muted-foreground" title={r.updatedAt.toISOString()}>
                          {formatTimestamp(r.updatedAt)}
                        </td>
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

              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <div>
                  Page {page + 1} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  {page <= 0 ? (
                    <Button variant="outline" size="sm" disabled>
                      <ChevronLeft className="mr-1 h-3 w-3" />
                      Prev
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={hrefWith({ page: page - 1 })} scroll={false}>
                        <ChevronLeft className="mr-1 h-3 w-3" />
                        Prev
                      </Link>
                    </Button>
                  )}
                  {page + 1 >= totalPages ? (
                    <Button variant="outline" size="sm" disabled>
                      Next
                      <ChevronRight className="ml-1 h-3 w-3" />
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={hrefWith({ page: page + 1 })} scroll={false}>
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
    </div>
  );
}

// Compact "MMM D, HH:mm" rendered server-side so SSR & client agree.
function formatTimestamp(d: Date): string {
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${date} ${time} UTC`;
}
