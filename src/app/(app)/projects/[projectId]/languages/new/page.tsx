import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { ProfileEditor } from "../profile-editor";

export default async function NewLanguageProfilePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "languages.write");

  const [providers, existingProfiles, taxonomyNodes] = await Promise.all([
    prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultModel: true },
    }),
    prisma.languageProfile.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { name: true, primary: true, register: true },
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
        <h1 className="text-2xl font-semibold tracking-tight">New language profile</h1>
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
        existingProfiles={existingProfiles.map(
          (p) => `${p.name} (primary=${p.primary}, register=${p.register})`,
        )}
        taxonomyNodes={taxonomyNodes.map((t) => t.name)}
        card={{
          title: "Profile",
          description:
            "Build a custom (language × script × register × code-switch) policy. For enterprise customer-support data in any locale, set register=formal, turn off colloquial particles, and enable the strict-spelling switch.",
        }}
        initial={{
          name: "",
          primary: "ms",
          secondary: ["en"],
          script: "latin",
          codeSwitchPolicy: "none",
          codeSwitchRate: null,
          register: "formal",
          allowParticles: false,
          bannedTokens: [],
          bannedPatterns: [],
          requireFormalMalay: false,
          englishLoanwordPolicy: "free",
          loanwordAllowlist: [],
          dialectHints: [],
          notes: null,
        }}
      />
    </div>
  );
}
