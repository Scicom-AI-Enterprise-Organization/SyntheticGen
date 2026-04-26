"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteLanguageProfile } from "./actions";

interface Profile {
  id: string;
  name: string;
  primary: string;
  secondary: string[];
  script: string;
  register: string;
  codeSwitchPolicy: string;
  codeSwitchRate: number | null;
  allowParticles: boolean;
  requireBahasaBaku: boolean;
  englishLoanwordPolicy: string;
  isPreset: boolean;
  bannedTokenCount: number;
}

export function LanguageProfilesTable({
  projectId,
  canWrite,
  profiles,
}: {
  projectId: string;
  canWrite: boolean;
  profiles: Profile[];
}) {
  const [pending, start] = useTransition();

  function onDelete(p: Profile) {
    if (!confirm(`Delete language profile "${p.name}"?`)) return;
    start(async () => {
      const res = await deleteLanguageProfile(projectId, p.id);
      if ("error" in res && res.error) toast.error(res.error);
      else toast.success("Profile deleted");
    });
  }

  if (profiles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No language profiles. The default presets should have been seeded — if not, run “Reseed
        defaults” from Settings.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Profile</th>
            <th className="py-2 pr-4 font-medium">Languages</th>
            <th className="py-2 pr-4 font-medium">Register</th>
            <th className="py-2 pr-4 font-medium">Code-switch</th>
            <th className="py-2 pr-4 font-medium">Enforcement</th>
            <th className="py-2 pl-4" />
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} className="border-b border-border/50 align-top">
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.isPreset && (
                    <Badge variant="secondary" className="text-[10px]">
                      preset
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">script: {p.script}</div>
              </td>
              <td className="py-3 pr-4 text-xs">
                <span className="font-medium">{p.primary}</span>
                {p.secondary.length > 0 && (
                  <span className="text-muted-foreground"> + {p.secondary.join(", ")}</span>
                )}
              </td>
              <td className="py-3 pr-4 text-xs">{p.register}</td>
              <td className="py-3 pr-4 text-xs">
                {p.codeSwitchPolicy}
                {p.codeSwitchRate != null && (
                  <span className="text-muted-foreground"> ({Math.round(p.codeSwitchRate * 100)}%)</span>
                )}
              </td>
              <td className="py-3 pr-4 text-xs">
                <div className="flex flex-wrap gap-1">
                  {p.allowParticles ? (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <ShieldOff className="h-3 w-3" />
                      particles OK
                    </Badge>
                  ) : (
                    <Badge variant="default" className="gap-1 text-[10px]">
                      <ShieldCheck className="h-3 w-3" />
                      no particles ({p.bannedTokenCount})
                    </Badge>
                  )}
                  {p.requireBahasaBaku && (
                    <Badge variant="default" className="text-[10px]">
                      Baku
                    </Badge>
                  )}
                  {p.englishLoanwordPolicy !== "free" && (
                    <Badge variant="outline" className="text-[10px]">
                      EN: {p.englishLoanwordPolicy}
                    </Badge>
                  )}
                </div>
              </td>
              <td className="py-3 pl-4 text-right">
                {canWrite && (
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="icon" aria-label="Edit">
                      <Link href={`/projects/${projectId}/languages/${p.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => onDelete(p)}
                      aria-label="Delete"
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
  );
}
