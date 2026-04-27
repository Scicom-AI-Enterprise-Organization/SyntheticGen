import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission, projectRoleAllows } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LanguageProfilesTable } from "./profiles-table";

export default async function LanguagesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "languages.read");
  const canWrite = role ? projectRoleAllows(role, "languages.write") : false;

  const profiles = await prisma.languageProfile.findMany({
    where: { projectId },
    orderBy: [{ isPreset: "desc" }, { name: "asc" }],
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Language profiles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each profile is a (language × script × register × code-switch policy) bundle. The two
            seeded presets cover most enterprise use cases.
          </p>
        </div>
        {canWrite && (
          <Button asChild>
            <Link href={`/projects/${projectId}/languages/new`}>
              <Plus className="mr-2 h-4 w-4" />
              New profile
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profiles ({profiles.length})</CardTitle>
          <CardDescription>
            <Sparkles className="mr-1 inline h-3 w-3" />
            Presets are highlighted. Edit any profile to customise banned tokens, loanword policy,
            or Formal Malay enforcement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LanguageProfilesTable
            projectId={projectId}
            canWrite={canWrite}
            profiles={profiles.map((p) => ({
              id: p.id,
              name: p.name,
              primary: p.primary,
              secondary: p.secondary,
              script: p.script,
              register: p.register,
              codeSwitchPolicy: p.codeSwitchPolicy,
              codeSwitchRate: p.codeSwitchRate,
              allowParticles: p.allowParticles,
              requireFormalMalay: p.requireFormalMalay,
              englishLoanwordPolicy: p.englishLoanwordPolicy,
              isPreset: p.isPreset,
              bannedTokenCount: p.bannedTokens.length,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
