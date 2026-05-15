import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireProjectPermission } from "@/lib/project-rbac";
import { Button } from "@/components/ui/button";
import { CreateFlowForm } from "../create-flow-form";

export default async function NewFlowPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "flows.write");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New flow</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/projects/${projectId}/flows`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to flows
          </Link>
        </Button>
      </div>
      <CreateFlowForm
        projectId={projectId}
        card={{
          title: "Flow",
          description:
            "You start with a Start → End scaffold. Open the editor to add intent / action / condition nodes and wire them up.",
        }}
      />
    </div>
  );
}
