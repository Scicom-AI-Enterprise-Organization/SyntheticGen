"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

const templateSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120),
  kind: z.enum(["system", "user-seed", "judge", "conversation-driver"]).default("user-seed"),
  description: z.string().max(2000).optional().nullable(),
  body: z.string().min(1).max(50000),
});

export async function createTemplate(input: z.infer<typeof templateSchema>) {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "templates.write");

  const created = await prisma.promptTemplate.create({
    data: {
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      description: parsed.data.description ?? null,
      body: parsed.data.body,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "template.create",
    targetKind: "PromptTemplate",
    targetId: created.id,
    metadata: { name: created.name, kind: created.kind },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/templates`);
  return { ok: true };
}

export async function deleteTemplate(projectId: string, id: string) {
  const { user } = await requireProjectPermission(projectId, "templates.write");
  const refCount = await prisma.generationRun.count({ where: { templateId: id } });
  if (refCount > 0) {
    return { error: `Cannot delete: ${refCount} run(s) reference this template` };
  }
  await prisma.promptTemplate.delete({ where: { id } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "template.delete",
    targetKind: "PromptTemplate",
    targetId: id,
  });
  revalidatePath(`/projects/${projectId}/templates`);
  return { ok: true };
}
