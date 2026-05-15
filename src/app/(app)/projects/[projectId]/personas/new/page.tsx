import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { PersonaForm } from "../persona-form";

export default async function NewPersonaPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "personas.write");

  const [languageProfiles, providers, taxonomyNodes] = await Promise.all([
    prisma.languageProfile.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, allowParticles: true, register: true },
    }),
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
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New persona</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/personas`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to personas
          </Link>
        </Button>
      </div>
      <PersonaForm
        projectId={projectId}
        languageProfiles={languageProfiles}
        providers={providers}
        taxonomyNodes={taxonomyNodes.map((t) => t.name)}
        card={{
          title: "Persona",
          description:
            "Conflict warning shown if persona formality clashes with chosen language profile.",
        }}
      />
    </div>
  );
}
