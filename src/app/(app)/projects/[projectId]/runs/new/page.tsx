import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RunWizard } from "./run-wizard";

export default async function NewRunPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "runs.execute");

  const [taxonomy, personas, languageProfiles, providers, templates, tools, flows] = await Promise.all([
    prisma.taxonomy.findFirst({
      where: { projectId },
      include: { nodes: { orderBy: { path: "asc" } } },
    }),
    prisma.persona.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, formality: true, languageProfileId: true },
    }),
    prisma.languageProfile.findMany({
      where: { projectId },
      orderBy: [{ isPreset: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        register: true,
        allowParticles: true,
        primary: true,
      },
    }),
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, defaultModel: true },
    }),
    prisma.promptTemplate.findMany({
      where: { projectId, kind: { in: ["user-seed", "system"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true },
    }),
    prisma.toolDef.findMany({
      where: { catalog: { projectId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, localePresets: true },
    }),
    prisma.flow.findMany({
      where: { projectId, isPublished: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, version: true },
    }),
  ]);

  const missing: string[] = [];
  if (!taxonomy || taxonomy.nodes.length === 0) missing.push("taxonomy nodes");
  if (personas.length === 0) missing.push("personas");
  if (languageProfiles.length === 0) missing.push("language profiles");
  if (providers.length === 0) missing.push("providers");
  if (templates.length === 0) missing.push("templates");

  const backButton = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/projects/${projectId}/runs`}>
        <ChevronLeft className="mr-1 h-4 w-4" />
        Back to runs
      </Link>
    </Button>
  );

  if (missing.length > 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">New run</h1>
          {backButton}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Missing prerequisites</CardTitle>
            <CardDescription>
              Set these up first before kicking off a run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="ml-5 list-disc space-y-1 text-sm">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New run</h1>
        {backButton}
      </div>
      <RunWizard
        projectId={projectId}
        taxonomy={taxonomy!.nodes.map((n) => ({ id: n.id, name: n.name, path: n.path }))}
        personas={personas}
        languageProfiles={languageProfiles}
        providers={providers}
        templates={templates}
        tools={tools.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          localePresets: t.localePresets,
        }))}
        flows={flows}
        card={{
          title: "Configuration",
          description:
            "The grid is taxonomyNodes × personas × difficulties × rowsPerCell. Slice 1 caps total cells at 1000.",
        }}
      />
    </div>
  );
}
