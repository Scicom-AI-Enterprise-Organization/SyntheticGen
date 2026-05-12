"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { deletePersona } from "./actions";
import { PersonaForm, type InitialPersona } from "./persona-form";

type Formality = "baku" | "colloquial" | "manglish" | "mixed";
type Urbanity = "urban" | "suburban" | "kampung";

interface LP {
  id: string;
  name: string;
  register: string;
  allowParticles: boolean;
}
interface Provider {
  id: string;
  name: string;
  defaultModel: string | null;
}

interface Persona {
  id: string;
  name: string;
  description: string | null;
  ethnicity: string | null;
  region: string | null;
  urbanity: string | null;
  ageRange: string | null;
  gender: string | null;
  occupation: string | null;
  formality: string | null;
  religionAware: boolean;
  dialectTags: string[];
  languageProfileId: string | null;
  languageProfile: { name: string; register: string; allowParticles: boolean } | null;
}

export function PersonasTable({
  projectId,
  canWrite,
  personas,
  languageProfiles,
  providers,
  taxonomyNodes,
}: {
  projectId: string;
  canWrite: boolean;
  personas: Persona[];
  languageProfiles: LP[];
  providers: Provider[];
  taxonomyNodes: string[];
}) {
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const confirm = useConfirm();

  const editing = personas.find((p) => p.id === editingId) ?? null;
  const editingInitial: InitialPersona | null = editing
    ? {
        id: editing.id,
        name: editing.name,
        description: editing.description,
        ethnicity: editing.ethnicity,
        region: editing.region,
        urbanity: (editing.urbanity as Urbanity | null) ?? null,
        ageRange: editing.ageRange,
        gender: editing.gender,
        occupation: editing.occupation,
        formality: (editing.formality as Formality | null) ?? null,
        religionAware: editing.religionAware,
        dialectTags: editing.dialectTags,
        languageProfileId: editing.languageProfileId,
      }
    : null;

  async function onDelete(p: Persona) {
    setActionError(null);
    const ok = await confirm({
      title: `Delete persona "${p.name}"?`,
      body: "Conversations already labelled with this persona keep the label.",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await deletePersona(projectId, p.id);
      if ("error" in res && (res as { error?: string }).error) {
        setActionError((res as { error: string }).error);
      }
    });
  }

  if (personas.length === 0) {
    return <p className="text-sm text-muted-foreground">No personas yet.</p>;
  }

  return (
    <div className="space-y-3">
      {actionError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {actionError}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Persona</th>
              <th className="py-2 pr-4 font-medium">Demographics</th>
              <th className="py-2 pr-4 font-medium">Formality</th>
              <th className="py-2 pr-4 font-medium">Language profile</th>
              <th className="py-2 pl-4" />
            </tr>
          </thead>
          <tbody>
            {personas.map((p) => (
              <tr key={p.id} className="border-b border-border/50 align-top">
                <td className="py-3 pr-4">
                  <div className="font-medium">{p.name}</div>
                  {p.dialectTags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.dialectTags.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-3 pr-4 text-xs text-muted-foreground">
                  <div>{[p.ethnicity, p.region, p.urbanity].filter(Boolean).join(" · ") || "—"}</div>
                  <div>{p.ageRange ?? ""}</div>
                </td>
                <td className="py-3 pr-4 text-xs">{p.formality ?? "—"}</td>
                <td className="py-3 pr-4 text-xs">
                  {p.languageProfile ? (
                    <div>
                      <div>{p.languageProfile.name}</div>
                      <div className="text-muted-foreground">
                        {p.languageProfile.register} ·{" "}
                        {p.languageProfile.allowParticles ? "particles OK" : "no particles"}
                      </div>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-3 pl-4 text-right">
                  {canWrite && (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingId(p.id)}
                        aria-label="Edit"
                        title="Edit persona"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        onClick={() => onDelete(p)}
                        aria-label="Delete"
                        title="Delete persona"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit persona</DialogTitle>
            <DialogDescription>
              Conversations already labelled with this persona keep their
              snapshot — only future runs see the changes.
            </DialogDescription>
          </DialogHeader>
          {editingInitial && (
            <PersonaForm
              projectId={projectId}
              languageProfiles={languageProfiles}
              providers={providers}
              taxonomyNodes={taxonomyNodes}
              initial={editingInitial}
              onDone={() => setEditingId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
