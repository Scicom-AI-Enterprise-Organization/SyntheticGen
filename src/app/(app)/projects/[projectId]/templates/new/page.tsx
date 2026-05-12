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
import { TemplateForm } from "../template-form";

export default async function NewTemplatePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "templates.write");

  const [providers, taxonomyNodes, languageProfiles, existing] = await Promise.all([
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
      where: { projectId },
      orderBy: { name: "asc" },
      select: { name: true, kind: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">New template</h1>
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${projectId}/templates`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to templates
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Template</CardTitle>
          <CardDescription>
            Mustache-style template with variables for persona / taxonomy / language.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemplateForm
            projectId={projectId}
            providers={providers}
            taxonomyNodes={taxonomyNodes.map((t) => t.name)}
            existingTemplates={existing.map((t) => `${t.name} (${t.kind})`)}
            languageProfiles={languageProfiles.map(
              (p) => `${p.name} (primary=${p.primary}, register=${p.register})`,
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
