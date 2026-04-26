"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelRunAction } from "../actions";

export function CancelRunButton({ projectId, runId }: { projectId: string; runId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (!confirm("Cancel this run? Pending jobs will be skipped.")) return;
        start(async () => {
          await cancelRunAction(projectId, runId);
          toast.success("Run cancelled");
          router.refresh();
        });
      }}
    >
      <XCircle className="mr-2 h-4 w-4" />
      Cancel run
    </Button>
  );
}
