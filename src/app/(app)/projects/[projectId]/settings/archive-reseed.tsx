"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveProject, reseedDefaults } from "../../actions";

export function ArchiveAndReseed({
  projectId,
  archived,
}: {
  projectId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onReseed() {
    start(async () => {
      const res = await reseedDefaults(projectId);
      if ("error" in res && res.error) toast.error(res.error);
      else if (res.ok) toast.success(`Reseed complete (${res.created} new profiles)`);
    });
  }

  function onArchive() {
    if (!confirm("Archive this project? It will be hidden from the projects list.")) return;
    start(async () => {
      const res = await archiveProject(projectId);
      if ("error" in res && (res as { error?: string }).error) {
        toast.error((res as { error: string }).error);
        return;
      }
      toast.success("Project archived");
      router.push("/projects");
    });
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" onClick={onReseed} disabled={pending}>
        <RefreshCcw className="mr-2 h-4 w-4" />
        Reseed default language profiles
      </Button>
      <Button variant="outline" onClick={onArchive} disabled={pending || archived}>
        <Archive className="mr-2 h-4 w-4" />
        {archived ? "Archived" : "Archive project"}
      </Button>
    </div>
  );
}
