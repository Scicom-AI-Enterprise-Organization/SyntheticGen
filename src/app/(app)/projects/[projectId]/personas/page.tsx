import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PersonasTable } from "./personas-table";

export default async function PersonasPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "personas.read");
  const canWrite = role ? projectRoleAllows(role, "personas.write") : false;

  const [personas, languageProfiles, providers, taxonomyNodes] = await Promise.all([
    prisma.persona.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      include: { languageProfile: { select: { name: true, allowParticles: true, register: true } } },
    }),
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
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Personas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Demographically-detailed personas: ethnicity × region × urbanity × age, with optional
            dialect tags and a default language profile. Drives realism in generated conversations.
          </p>
        </div>
        {canWrite && (
          <Button asChild>
            <Link href={`/projects/${projectId}/personas/new`}>
              <Plus className="mr-2 h-4 w-4" />
              New persona
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personas ({personas.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <PersonasTable
            projectId={projectId}
            canWrite={canWrite}
            languageProfiles={languageProfiles}
            providers={providers}
            taxonomyNodes={taxonomyNodes.map((t) => t.name)}
            personas={personas.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              ethnicity: p.ethnicity,
              region: p.region,
              urbanity: p.urbanity,
              ageRange: p.ageRange,
              gender: p.gender,
              occupation: p.occupation,
              formality: p.formality,
              religionAware: p.religionAware,
              dialectTags: p.dialectTags,
              languageProfileId: p.languageProfileId,
              languageProfile: p.languageProfile
                ? {
                    name: p.languageProfile.name,
                    register: p.languageProfile.register,
                    allowParticles: p.languageProfile.allowParticles,
                  }
                : null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
