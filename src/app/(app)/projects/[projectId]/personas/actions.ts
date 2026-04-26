"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

const personaSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional().nullable(),
  ethnicity: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  urbanity: z.enum(["urban", "suburban", "kampung"]).optional().nullable(),
  ageRange: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  occupation: z.string().optional().nullable(),
  formality: z.enum(["baku", "colloquial", "manglish", "mixed"]).optional().nullable(),
  religionAware: z.boolean().default(false),
  dialectTags: z.array(z.string()).default([]),
  languageProfileId: z.string().optional().nullable(),
});

export async function createPersona(input: z.infer<typeof personaSchema>) {
  const parsed = personaSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "personas.write");

  const data = parsed.data;
  const created = await prisma.persona.create({
    data: {
      projectId: data.projectId,
      name: data.name,
      description: data.description ?? null,
      ethnicity: data.ethnicity ?? null,
      region: data.region ?? null,
      urbanity: data.urbanity ?? null,
      ageRange: data.ageRange ?? null,
      gender: data.gender ?? null,
      occupation: data.occupation ?? null,
      formality: data.formality ?? null,
      religionAware: data.religionAware,
      dialectTags: data.dialectTags,
      languageProfileId: data.languageProfileId ?? null,
    },
  });

  await logAudit({
    projectId: data.projectId,
    actorUserId: user.id,
    action: "persona.create",
    targetKind: "Persona",
    targetId: created.id,
    metadata: { name: created.name },
  });

  revalidatePath(`/projects/${data.projectId}/personas`);
  return { ok: true, id: created.id };
}

export async function deletePersona(projectId: string, id: string) {
  const { user } = await requireProjectPermission(projectId, "personas.write");
  await prisma.persona.delete({ where: { id } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "persona.delete",
    targetKind: "Persona",
    targetId: id,
  });
  revalidatePath(`/projects/${projectId}/personas`);
  return { ok: true };
}
