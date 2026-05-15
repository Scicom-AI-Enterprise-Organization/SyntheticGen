import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { ProfileEditor } from "../profile-editor";

export default async function EditLanguageProfilePage({
  params,
}: {
  params: Promise<{ projectId: string; profileId: string }>;
}) {
  const { projectId, profileId } = await params;
  await requireProjectPermission(projectId, "languages.write");

  const [p, providers] = await Promise.all([
    prisma.languageProfile.findUnique({ where: { id: profileId } }),
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultModel: true },
    }),
  ]);
  if (!p || p.projectId !== projectId) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Edit language profile</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/languages`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to languages
          </Link>
        </Button>
      </div>
      <ProfileEditor
        projectId={projectId}
        providers={providers}
        card={{
          title: "Profile",
          description: p.notes ?? "No notes",
        }}
        initial={{
          id: p.id,
          name: p.name,
          primary: p.primary as "ms" | "en" | "zh" | "ta",
          secondary: p.secondary,
          script: p.script as "latin" | "jawi" | "hans" | "hant" | "tamil",
          codeSwitchPolicy: p.codeSwitchPolicy as "none" | "inter-sentential" | "intra-sentential" | "rojak",
          codeSwitchRate: p.codeSwitchRate,
          register: p.register as "formal" | "semi-formal" | "colloquial" | "mixed",
          allowParticles: p.allowParticles,
          bannedTokens: p.bannedTokens,
          bannedPatterns: p.bannedPatterns,
          requireFormalMalay: p.requireFormalMalay,
          englishLoanwordPolicy: p.englishLoanwordPolicy as "forbid" | "allowlist" | "free",
          loanwordAllowlist: p.loanwordAllowlist,
          dialectHints: p.dialectHints,
          notes: p.notes,
        }}
      />
    </div>
  );
}
