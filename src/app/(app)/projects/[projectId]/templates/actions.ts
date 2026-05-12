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

const updateSchema = templateSchema.extend({ id: z.string() });

export async function updateTemplate(input: z.infer<typeof updateSchema>) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "templates.write");

  // Belt-and-braces — make sure the template actually belongs to this project.
  const existing = await prisma.promptTemplate.findFirst({
    where: { id: parsed.data.id, projectId: parsed.data.projectId },
    select: { id: true, name: true, kind: true, body: true, version: true },
  });
  if (!existing) return { error: "Template not found in this project" };

  // Bump version when the body changes — historical runs that already
  // snapshotted the body keep theirs; future runs see the new version.
  const bodyChanged = existing.body !== parsed.data.body;
  const updated = await prisma.promptTemplate.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      kind: parsed.data.kind,
      description: parsed.data.description ?? null,
      body: parsed.data.body,
      version: bodyChanged ? existing.version + 1 : existing.version,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "template.update",
    targetKind: "PromptTemplate",
    targetId: updated.id,
    metadata: {
      name: updated.name,
      kind: updated.kind,
      bodyChanged,
      newVersion: updated.version,
    },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/templates`);
  return { ok: true, version: updated.version };
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
