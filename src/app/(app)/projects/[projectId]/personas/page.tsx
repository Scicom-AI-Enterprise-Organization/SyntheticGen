import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PersonaForm } from "./persona-form";
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Personas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Demographically-detailed personas: ethnicity × region × urbanity × age, with optional
          dialect tags and a default language profile. Drives realism in generated conversations.
        </p>
      </div>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>New persona</CardTitle>
            <CardDescription>
              Conflict warning shown if persona formality clashes with chosen language profile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PersonaForm
              projectId={projectId}
              languageProfiles={languageProfiles}
              providers={providers}
              taxonomyNodes={taxonomyNodes.map((t) => t.name)}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Personas ({personas.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <PersonasTable
            projectId={projectId}
            canWrite={canWrite}
            personas={personas.map((p) => ({
              id: p.id,
              name: p.name,
              ethnicity: p.ethnicity,
              region: p.region,
              urbanity: p.urbanity,
              ageRange: p.ageRange,
              formality: p.formality,
              dialectTags: p.dialectTags,
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
