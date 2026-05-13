import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Edit language profile</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>{p.notes ?? "No notes"}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileEditor
            projectId={projectId}
            providers={providers}
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
        </CardContent>
      </Card>
    </div>
  );
}
