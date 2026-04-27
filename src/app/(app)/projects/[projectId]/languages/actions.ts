"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

const profileSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120),
  primary: z.enum(["ms", "en", "zh", "ta"]),
  secondary: z.array(z.string()).default([]),
  script: z.enum(["latin", "jawi", "hans", "hant", "tamil"]).default("latin"),
  codeSwitchPolicy: z.enum(["none", "inter-sentential", "intra-sentential", "rojak"]).default("none"),
  codeSwitchRate: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional(),
  register: z.enum(["formal", "semi-formal", "colloquial", "mixed"]).default("formal"),
  allowParticles: z.boolean().default(false),
  bannedTokens: z.array(z.string()).default([]),
  bannedPatterns: z.array(z.string()).default([]),
  requireFormalMalay: z.boolean().default(false),
  englishLoanwordPolicy: z.enum(["forbid", "allowlist", "free"]).default("free"),
  loanwordAllowlist: z.array(z.string()).default([]),
  dialectHints: z.array(z.string()).default([]),
  notes: z.string().max(2000).optional().nullable(),
});

export type LanguageProfileInput = z.infer<typeof profileSchema>;

export async function upsertLanguageProfile(input: LanguageProfileInput & { id?: string }) {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "languages.write");

  const data = parsed.data;
  if (input.id) {
    await prisma.languageProfile.update({
      where: { id: input.id },
      data: {
        name: data.name,
        primary: data.primary,
        secondary: data.secondary,
        script: data.script,
        codeSwitchPolicy: data.codeSwitchPolicy,
        codeSwitchRate: data.codeSwitchRate ?? null,
        register: data.register,
        allowParticles: data.allowParticles,
        bannedTokens: data.bannedTokens,
        bannedPatterns: data.bannedPatterns,
        requireFormalMalay: data.requireFormalMalay,
        englishLoanwordPolicy: data.englishLoanwordPolicy,
        loanwordAllowlist: data.loanwordAllowlist,
        dialectHints: data.dialectHints,
        notes: data.notes ?? null,
      },
    });
    await logAudit({
      projectId: data.projectId,
      actorUserId: user.id,
      action: "language-profile.update",
      targetKind: "LanguageProfile",
      targetId: input.id,
    });
  } else {
    const created = await prisma.languageProfile.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        primary: data.primary,
        secondary: data.secondary,
        script: data.script,
        codeSwitchPolicy: data.codeSwitchPolicy,
        codeSwitchRate: data.codeSwitchRate ?? null,
        register: data.register,
        allowParticles: data.allowParticles,
        bannedTokens: data.bannedTokens,
        bannedPatterns: data.bannedPatterns,
        requireFormalMalay: data.requireFormalMalay,
        englishLoanwordPolicy: data.englishLoanwordPolicy,
        loanwordAllowlist: data.loanwordAllowlist,
        dialectHints: data.dialectHints,
        notes: data.notes ?? null,
      },
    });
    await logAudit({
      projectId: data.projectId,
      actorUserId: user.id,
      action: "language-profile.create",
      targetKind: "LanguageProfile",
      targetId: created.id,
      metadata: { name: created.name },
    });
  }

  revalidatePath(`/projects/${data.projectId}/languages`);
  return { ok: true };
}

export async function createLanguageProfileAndRedirect(input: LanguageProfileInput) {
  const res = await upsertLanguageProfile(input);
  if (res.ok) {
    redirect(`/projects/${input.projectId}/languages`);
  }
  return res;
}

export async function deleteLanguageProfile(projectId: string, id: string) {
  const { user } = await requireProjectPermission(projectId, "languages.write");

  // Block deletion if profile is referenced by personas or runs.
  const refCount = await prisma.persona.count({ where: { languageProfileId: id } });
  if (refCount > 0) {
    return { error: `Cannot delete: ${refCount} persona(s) reference this profile` };
  }
  const runRef = await prisma.generationRun.count({ where: { languageProfileId: id } });
  if (runRef > 0) {
    return { error: `Cannot delete: ${runRef} run(s) reference this profile` };
  }

  await prisma.languageProfile.delete({ where: { id } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "language-profile.delete",
    targetKind: "LanguageProfile",
    targetId: id,
  });
  revalidatePath(`/projects/${projectId}/languages`);
  return { ok: true };
}
