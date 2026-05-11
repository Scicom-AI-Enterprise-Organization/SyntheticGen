"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

const axisSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z][a-z0-9_]*$/, "key must be lowercase snake_case"),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(1000),
  scale: z.number().int().min(2).max(10),
  weight: z.number().min(0).max(10),
  examples: z
    .array(
      z.object({
        score: z.number().int(),
        output: z.string().max(2000),
        reason: z.string().max(500).optional().nullable(),
      }),
    )
    .max(8)
    .optional()
    .nullable(),
});

const createSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional().nullable(),
  axes: z.array(axisSchema).min(1).max(10),
  aiDrafted: z.boolean().default(false),
});

const updateSchema = createSchema.extend({ id: z.string() });

export async function createRubric(input: z.infer<typeof createSchema>) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.write");

  if (uniqueAxisKeys(parsed.data.axes).size !== parsed.data.axes.length) {
    return { error: "Axis keys must be unique within a rubric" };
  }

  try {
    const created = await prisma.rubric.create({
      data: {
        projectId: parsed.data.projectId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        axes: parsed.data.axes,
        aiDrafted: parsed.data.aiDrafted,
        createdById: user.id,
      },
    });
    await logAudit({
      projectId: parsed.data.projectId,
      actorUserId: user.id,
      action: "rubric.create",
      targetKind: "Rubric",
      targetId: created.id,
      metadata: { name: created.name, axisCount: parsed.data.axes.length },
    });
    revalidatePath(`/projects/${parsed.data.projectId}/rubrics`);
    return { ok: true, id: created.id };
  } catch (e) {
    if (isUniqueConstraint(e)) return { error: "A rubric with this name already exists" };
    throw e;
  }
}

export async function updateRubric(input: z.infer<typeof updateSchema>) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.write");

  if (uniqueAxisKeys(parsed.data.axes).size !== parsed.data.axes.length) {
    return { error: "Axis keys must be unique within a rubric" };
  }

  const existing = await prisma.rubric.findFirst({
    where: { id: parsed.data.id, projectId: parsed.data.projectId },
    select: { id: true, isPreset: true },
  });
  if (!existing) return { error: "Rubric not found in this project" };
  if (existing.isPreset) return { error: "Preset rubrics are read-only; clone it first" };

  try {
    await prisma.rubric.update({
      where: { id: parsed.data.id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        axes: parsed.data.axes,
      },
    });
    await logAudit({
      projectId: parsed.data.projectId,
      actorUserId: user.id,
      action: "rubric.update",
      targetKind: "Rubric",
      targetId: parsed.data.id,
    });
    revalidatePath(`/projects/${parsed.data.projectId}/rubrics`);
    return { ok: true };
  } catch (e) {
    if (isUniqueConstraint(e)) return { error: "A rubric with this name already exists" };
    throw e;
  }
}

export async function deleteRubric(projectId: string, id: string) {
  const { user } = await requireProjectPermission(projectId, "benchmarks.write");
  const existing = await prisma.rubric.findFirst({
    where: { id, projectId },
    select: { id: true, isPreset: true },
  });
  if (!existing) return { error: "Rubric not found" };
  if (existing.isPreset) return { error: "Preset rubrics cannot be deleted" };

  await prisma.rubric.delete({ where: { id } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "rubric.delete",
    targetKind: "Rubric",
    targetId: id,
  });
  revalidatePath(`/projects/${projectId}/rubrics`);
  return { ok: true };
}

function uniqueAxisKeys(axes: { key: string }[]): Set<string> {
  return new Set(axes.map((a) => a.key));
}

function isUniqueConstraint(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}
