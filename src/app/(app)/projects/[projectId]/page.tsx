import Link from "next/link";
import { ArrowRight, Languages, Users2, FileCode, Play, MessagesSquare, BookOpen } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "project.read");

  const [project, counts, recentRuns, recentConvos] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    Promise.all([
      prisma.persona.count({ where: { projectId } }),
      prisma.languageProfile.count({ where: { projectId } }),
      prisma.promptTemplate.count({ where: { projectId } }),
      prisma.providerCredential.count({ where: { projectId } }),
      prisma.generationRun.count({ where: { projectId } }),
      prisma.conversation.count({ where: { projectId } }),
      prisma.knowledgeBaseEntry.count({ where: { projectId } }),
    ]),
    prisma.generationRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, status: true, producedCount: true, targetCount: true, createdAt: true },
    }),
    prisma.conversation.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, primaryLanguage: true, status: true, turnCount: true, createdAt: true },
    }),
  ]);

  const [personas, languages, templates, providers, runs, convos, knowledge] = counts;

  const cards: { label: string; value: number; href: string; icon: typeof Languages }[] = [
    { label: "Personas", value: personas, href: `/projects/${projectId}/personas`, icon: Users2 },
    { label: "Language profiles", value: languages, href: `/projects/${projectId}/languages`, icon: Languages },
    { label: "Templates", value: templates, href: `/projects/${projectId}/templates`, icon: FileCode },
    { label: "Knowledge base", value: knowledge, href: `/projects/${projectId}/knowledge`, icon: BookOpen },
    { label: "Providers", value: providers, href: `/projects/${projectId}/providers`, icon: Play },
    { label: "Runs", value: runs, href: `/projects/${projectId}/runs`, icon: Play },
    { label: "Conversations", value: convos, href: `/projects/${projectId}/conversations`, icon: MessagesSquare },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center justify-between">
              <c.icon className="h-4 w-4 text-muted-foreground" />
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="mt-3 text-2xl font-semibold">{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>Last 5 generation runs.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recentRuns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/projects/${projectId}/runs/${r.id}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {r.producedCount}/{r.targetCount}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                      {r.status}
                    </span>
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
                      href={`/projects/${projectId}/conversations?focus=${c.id}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {c.id.slice(0, 8)}…
                    </Link>
                    <span className="text-xs text-muted-foreground">{c.turnCount} turns</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                      {c.primaryLanguage ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
