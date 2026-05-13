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
        <Button asChild variant="outline" size="sm">
          <Link href={`/projects/${projectId}/personas`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to personas
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Persona</CardTitle>
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
    </div>
  );
}
