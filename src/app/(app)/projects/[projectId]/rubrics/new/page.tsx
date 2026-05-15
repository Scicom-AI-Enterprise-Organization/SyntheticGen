import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { RubricForm } from "../rubric-form";

export default async function NewRubricPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "benchmarks.write");

  const providers = await prisma.providerCredential.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, defaultModel: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New rubric</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/rubrics`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to rubrics
          </Link>
        </Button>
      </div>
      <RubricForm
        projectId={projectId}
        providers={providers}
        card={{
          title: "Rubric",
          description: (
            <>
              Start from the Malaysia-focused defaults, edit them, or hit{" "}
              <em>Fill with AI</em> to draft a rubric from a sentence.
            </>
          ),
        }}
      />
    </div>
  );
}
