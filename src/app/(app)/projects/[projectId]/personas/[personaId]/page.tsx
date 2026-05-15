import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { PersonaForm, type InitialPersona } from "../persona-form";

type Formality = "baku" | "colloquial" | "manglish" | "mixed";
type Urbanity = "urban" | "suburban" | "kampung";

export default async function EditPersonaPage({
  params,
}: {
  params: Promise<{ projectId: string; personaId: string }>;
}) {
  const { projectId, personaId } = await params;
  await requireProjectPermission(projectId, "personas.write");

  const [persona, languageProfiles, providers, taxonomyNodes] = await Promise.all([
    prisma.persona.findUnique({ where: { id: personaId } }),
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
  if (!persona || persona.projectId !== projectId) notFound();

  const initial: InitialPersona = {
    id: persona.id,
    name: persona.name,
    description: persona.description,
    ethnicity: persona.ethnicity,
    region: persona.region,
    urbanity: (persona.urbanity as Urbanity | null) ?? null,
    ageRange: persona.ageRange,
    gender: persona.gender,
    occupation: persona.occupation,
    formality: (persona.formality as Formality | null) ?? null,
    religionAware: persona.religionAware,
    dialectTags: persona.dialectTags,
    languageProfileId: persona.languageProfileId,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{persona.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Edit persona</p>
        </div>
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
        initial={initial}
        card={{
          title: "Persona",
          description:
            "Conversations already labelled with this persona keep their snapshot — only future runs see the changes.",
        }}
      />
    </div>
  );
}
