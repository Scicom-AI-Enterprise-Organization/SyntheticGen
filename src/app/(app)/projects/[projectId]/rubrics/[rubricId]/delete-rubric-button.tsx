"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteRubric } from "../actions";

export function DeleteRubricButton({
  projectId,
  rubricId,
  name,
}: {
  projectId: string;
  rubricId: string;
  name: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onDelete() {
    setError(null);
    if (confirm !== name) {
      setError(`Type "${name}" exactly to confirm`);
      return;
    }
    start(async () => {
      const res = await deleteRubric(projectId, rubricId);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.push(`/projects/${projectId}/rubrics`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="confirm-delete-rubric" className="text-xs">
        Type{" "}
        <code
          className="cursor-text rounded bg-muted px-1 font-mono select-text"
          onClick={(e) => {
            // Click-to-select so the rubric name is easy to copy out of the
            // Label (which is `select-none` by default).
            const range = document.createRange();
            range.selectNodeContents(e.currentTarget);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }}
          title="Click to select, then ⌘/Ctrl-C to copy"
        >
          {name}
        </code>{" "}
        to confirm
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="confirm-delete-rubric"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={name}
          className="max-w-sm"
        />
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending || confirm !== name}
          onClick={onDelete}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          Delete rubric
        </Button>
      </div>
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
