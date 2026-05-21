"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { importGlobalProviders } from "./actions";

export interface AvailableGlobal {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  defaultModel: string | null;
  alreadyImported: boolean;
}

export function ImportGlobalsDialog({
  projectId,
  globals,
}: {
  projectId: string;
  globals: AvailableGlobal[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSubmit() {
    if (selected.size === 0) {
      setErr("Pick at least one global provider to import");
      return;
    }
    setErr(null);
    start(async () => {
      const res = await importGlobalProviders({
        projectId,
        globalProviderIds: Array.from(selected),
      });
      if ("error" in res && res.error) {
        setErr(res.error);
        return;
      }
      setOpen(false);
      setSelected(new Set());
      router.refresh();
    });
  }

  const hasAny = globals.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelected(new Set());
          setErr(null);
        }
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!hasAny}>
          <Download className="mr-1 h-4 w-4" />
          Import from global
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import global providers</DialogTitle>
          <DialogDescription>
            Picks an org-wide provider template and copies it into this
            project. Each import creates an independent project provider —
            edits don&apos;t flow back to the global, and deleting the global
            doesn&apos;t touch your project copy.
          </DialogDescription>
        </DialogHeader>

        {globals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No global providers are configured. Ask an admin to add some under{" "}
            <code>/admin/providers</code>.
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-2">
            {globals.map((g) => {
              const checked = selected.has(g.id);
              return (
                <li key={g.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-background ${
                      g.alreadyImported ? "opacity-70" : ""
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(g.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{g.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {g.kind}
                        </Badge>
                        {g.alreadyImported && (
                          <Badge variant="secondary" className="text-[10px]">
                            already imported
                          </Badge>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {g.baseUrl}
                        {g.defaultModel ? ` · ${g.defaultModel}` : ""}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {err && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={pending || selected.size === 0}
          >
            {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Import {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
