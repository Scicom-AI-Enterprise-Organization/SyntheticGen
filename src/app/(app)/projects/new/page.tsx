import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { CreateProjectForm } from "../create-project-form";

export default async function NewProjectPage() {
  await requirePermission("projects:write");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/projects">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to projects
          </Link>
        </Button>
      </div>
      <CreateProjectForm />
    </div>
  );
}
