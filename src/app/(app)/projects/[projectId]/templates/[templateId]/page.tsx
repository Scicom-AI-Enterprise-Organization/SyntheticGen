import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { TemplateForm } from "../template-form";

type Kind = "system" | "user-seed" | "judge" | "conversation-driver";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ projectId: string; templateId: string }>;
}) {
  const { projectId, templateId } = await params;
  await requireProjectPermission(projectId, "templates.write");

  const [template, providers, taxonomyNodes, languageProfiles, others] = await Promise.all([
    prisma.promptTemplate.findUnique({ where: { id: templateId } }),
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultModel: true },
    }),
    prisma.taxonomyNode.findMany({
      where: { taxonomy: { projectId } },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
    prisma.languageProfile.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { name: true, primary: true, register: true },
    }),
    prisma.promptTemplate.findMany({
      where: { projectId, id: { not: templateId } },
      orderBy: { name: "asc" },
      select: { name: true, kind: true },
    }),
  ]);
  if (!template || template.projectId !== projectId) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{template.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Edit template · v{template.version}</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/templates`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to templates
          </Link>
        </Button>
      </div>
      <TemplateForm
        projectId={projectId}
        providers={providers}
        taxonomyNodes={taxonomyNodes.map((t) => t.name)}
        existingTemplates={others.map((t) => `${t.name} (${t.kind})`)}
        languageProfiles={languageProfiles.map(
          (p) => `${p.name} (primary=${p.primary}, register=${p.register})`,
        )}
        initial={{
          id: template.id,
          name: template.name,
          kind: template.kind as Kind,
          description: template.description,
          body: template.body,
        }}
        card={{
          title: "Template",
          description:
            "Body changes bump the template version. Runs that already started keep their frozen copy.",
        }}
      />
    </div>
  );
}
