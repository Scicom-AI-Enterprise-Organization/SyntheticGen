import Link from "next/link";
import { Plus, FolderKanban } from "lucide-react";
import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateProjectForm } from "./create-project-form";

export default async function ProjectsPage() {
  const user = await requirePermission("projects:read");
  const isGlobalAdmin =
    user.permissions.includes("users:write") &&
    user.permissions.includes("roles:write");

  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      ...(isGlobalAdmin
        ? {}
        : { members: { some: { userId: user.id } } }),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { runs: true, conversations: true, datasets: true } },
      members: { where: { userId: user.id }, take: 1 },
    },
  });

  const canCreate = user.permissions.includes("projects:write");

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="mt-2 text-muted-foreground">
            Synthetic dataset workspaces. Each project scopes its own personas, language
            profiles, prompt templates, runs, and datasets.
          </p>
        </div>
      </div>

      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Create project</CardTitle>
            <CardDescription>
              You become the OWNER. Two LanguageProfile presets are seeded automatically —
              edit them, clone them, or replace with profiles tuned for your locale.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateProjectForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your projects</CardTitle>
          <CardDescription>
            {projects.length} project{projects.length === 1 ? "" : "s"} you can access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              <FolderKanban className="mx-auto mb-2 h-6 w-6" />
              No projects yet.
              {canCreate ? " Create your first one above." : " Ask an owner to add you."}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => {
                const role = isGlobalAdmin ? "OWNER (global)" : p.members[0]?.role ?? "—";
                return (
                  <li key={p.id} className="py-3">
                    <Link
                      href={`/projects/${p.id}`}
                      className="flex items-center justify-between gap-4 rounded-md px-2 py-2 hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{p.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {p.description || p.slug}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                        <span>{p._count.runs} runs</span>
                        <span>{p._count.conversations} convos</span>
                        <span>{p._count.datasets} datasets</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                          {role}
                        </span>
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
