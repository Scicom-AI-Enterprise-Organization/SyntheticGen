"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { deletePersona } from "./actions";

interface Persona {
  id: string;
  name: string;
  ethnicity: string | null;
  region: string | null;
  urbanity: string | null;
  ageRange: string | null;
  formality: string | null;
  dialectTags: string[];
  languageProfile: { name: string; register: string; allowParticles: boolean } | null;
}

export function PersonasTable({
  projectId,
  canWrite,
  personas,
}: {
  projectId: string;
  canWrite: boolean;
  personas: Persona[];
}) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  async function onDelete(p: Persona) {
    const ok = await confirm({
      title: `Delete persona "${p.name}"?`,
      body: "Conversations already labelled with this persona keep the label.",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await deletePersona(projectId, p.id);
      if ("error" in res && (res as { error?: string }).error)
        toast.error((res as { error: string }).error);
      else toast.success("Persona deleted");
    });
  }

  if (personas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No personas yet.</p>
    );
  }

  return (
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
                      {p.languageProfile.register} · {p.languageProfile.allowParticles ? "particles OK" : "no particles"}
                    </div>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-3 pl-4 text-right">
                {canWrite && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    onClick={() => onDelete(p)}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
