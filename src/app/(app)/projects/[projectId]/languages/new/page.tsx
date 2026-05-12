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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New language profile</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Build a custom (language × script × register × code-switch) policy. For enterprise
            customer-support data in any locale, set <code>register=formal</code>, turn off
            colloquial particles, and enable the strict-spelling switch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileEditor
            projectId={projectId}
            providers={providers}
            existingProfiles={existingProfiles.map(
              (p) => `${p.name} (primary=${p.primary}, register=${p.register})`,
            )}
            taxonomyNodes={taxonomyNodes.map((t) => t.name)}
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
        </CardContent>
      </Card>
    </div>
  );
}
