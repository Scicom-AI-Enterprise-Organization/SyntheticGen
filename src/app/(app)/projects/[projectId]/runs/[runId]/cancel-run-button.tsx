"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { cancelRunAction } from "../actions";

export function CancelRunButton({ projectId, runId }: { projectId: string; runId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({
          title: "Cancel this run?",
          body: "Pending jobs will be skipped. Jobs already in flight finish and write their results before the run stops.",
          confirmText: "Cancel run",
          cancelText: "Keep running",
          destructive: true,
        });
        if (!ok) return;
        start(async () => {
          await cancelRunAction(projectId, runId);
          router.refresh();
        });
      }}
    >
      <XCircle className="mr-2 h-4 w-4" />
      Cancel run
    </Button>
  );
}
