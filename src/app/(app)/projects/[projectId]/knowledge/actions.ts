"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(50_000),
  tags: z.array(z.string()).default([]),
  taxonomyNodeIds: z.array(z.string()).default([]),
  sourceUrl: z.string().url().optional().nullable(),
});

const updateSchema = createSchema.extend({ id: z.string() });

export async function createKnowledgeEntry(input: z.infer<typeof createSchema>) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "knowledge.write");

  const created = await prisma.knowledgeBaseEntry.create({
    data: {
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      content: parsed.data.content,
      tags: parsed.data.tags,
      taxonomyNodeIds: parsed.data.taxonomyNodeIds,
      sourceUrl: parsed.data.sourceUrl ?? null,
      createdById: user.id,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "knowledge.create",
    targetKind: "KnowledgeBaseEntry",
    targetId: created.id,
    metadata: { title: created.title, taxonomyNodeIds: created.taxonomyNodeIds },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/knowledge`);
  return { ok: true, id: created.id };
}

export async function updateKnowledgeEntry(input: z.infer<typeof updateSchema>) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "knowledge.write");

  const existing = await prisma.knowledgeBaseEntry.findFirst({
    where: { id: parsed.data.id, projectId: parsed.data.projectId },
    select: { id: true },
  });
  if (!existing) return { error: "Entry not found in this project" };

  await prisma.knowledgeBaseEntry.update({
    where: { id: parsed.data.id },
    data: {
      title: parsed.data.title,
      content: parsed.data.content,
      tags: parsed.data.tags,
      taxonomyNodeIds: parsed.data.taxonomyNodeIds,
      sourceUrl: parsed.data.sourceUrl ?? null,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "knowledge.update",
    targetKind: "KnowledgeBaseEntry",
    targetId: parsed.data.id,
  });

  revalidatePath(`/projects/${parsed.data.projectId}/knowledge`);
  return { ok: true };
}

const bulkCreateSchema = z.object({
  projectId: z.string(),
  taxonomyNodeIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  entries: z
    .array(
      z.object({
        title: z.string().min(1).max(240),
        content: z.string().min(1).max(50_000),
        sourceUrl: z.string().url().optional().nullable(),
      }),
    )
    .min(1)
    .max(50),
});

export async function bulkCreateKnowledgeEntries(input: z.infer<typeof bulkCreateSchema>) {
  const parsed = bulkCreateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "knowledge.write");

  const rows = parsed.data.entries.map((e) => ({
    projectId: parsed.data.projectId,
    title: e.title.slice(0, 240),
    content: e.content,
    tags: parsed.data.tags,
    taxonomyNodeIds: parsed.data.taxonomyNodeIds,
    sourceUrl: e.sourceUrl ?? null,
    createdById: user.id,
  }));
  const result = await prisma.knowledgeBaseEntry.createMany({ data: rows });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "knowledge.bulkCreate",
    targetKind: "KnowledgeBaseEntry",
    targetId: parsed.data.projectId,
    metadata: { count: result.count, source: "crawl" },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/knowledge`);
  return { ok: true, count: result.count };
}

export async function deleteKnowledgeCrawl(projectId: string, crawlId: string) {
  const { user } = await requireProjectPermission(projectId, "knowledge.write");
  const existing = await prisma.knowledgeCrawl.findFirst({
    where: { id: crawlId, projectId },
    select: { id: true },
  });
  if (!existing) return { error: "Crawl not found in this project" };
  await prisma.knowledgeCrawl.delete({ where: { id: crawlId } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "knowledge.crawl.delete",
    targetKind: "KnowledgeCrawl",
    targetId: crawlId,
  });
  revalidatePath(`/projects/${projectId}/knowledge`);
  return { ok: true };
}

export async function deleteKnowledgeEntry(projectId: string, id: string) {
  const { user } = await requireProjectPermission(projectId, "knowledge.write");
  await prisma.knowledgeBaseEntry.delete({ where: { id } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "knowledge.delete",
    targetKind: "KnowledgeBaseEntry",
    targetId: id,
  });
  revalidatePath(`/projects/${projectId}/knowledge`);
  return { ok: true };
}
