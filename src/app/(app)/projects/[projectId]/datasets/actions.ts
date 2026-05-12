"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { buildExport, tryCall } from "@/lib/synthgen-api";

const createDatasetSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
});

export async function createDataset(input: z.infer<typeof createDatasetSchema>) {
  const parsed = createDatasetSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "datasets.freeze");
  const created = await prisma.dataset.create({
    data: {
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    },
  });
  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "dataset.create",
    targetKind: "Dataset",
    targetId: created.id,
    metadata: { name: created.name },
  });
  revalidatePath(`/projects/${parsed.data.projectId}/datasets`);
  return { ok: true, id: created.id };
}

const freezeSchema = z.object({
  projectId: z.string(),
  datasetId: z.string(),
  version: z.string().min(1).max(40),
  description: z.string().max(2000).optional().nullable(),
  filterRunId: z.string().optional().nullable(),
  filterStatus: z.enum(["accepted", "any"]).default("accepted"),
});

export async function freezeDatasetVersion(input: z.infer<typeof freezeSchema>) {
  const parsed = freezeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "datasets.freeze");

  const conv = await prisma.conversation.findMany({
    where: {
      projectId: parsed.data.projectId,
      ...(parsed.data.filterRunId ? { runId: parsed.data.filterRunId } : {}),
      ...(parsed.data.filterStatus === "accepted" ? { status: "accepted" } : {}),
    },
    select: { id: true, primaryLanguage: true, persona: { select: { id: true } } },
  });

  if (conv.length === 0) {
    return { error: "No conversations match the filter — nothing to freeze." };
  }

  // Build stats payload.
  const statsByLang: Record<string, number> = {};
  const statsByPersona: Record<string, number> = {};
  for (const c of conv) {
    const lang = c.primaryLanguage ?? "unknown";
    statsByLang[lang] = (statsByLang[lang] ?? 0) + 1;
    const personaId = c.persona?.id ?? "unknown";
    statsByPersona[personaId] = (statsByPersona[personaId] ?? 0) + 1;
  }

  const dataset = await prisma.dataset.findUniqueOrThrow({
    where: { id: parsed.data.datasetId },
    include: { currentVersion: true },
  });

  const versionRow = await prisma.$transaction(async (tx) => {
    const v = await tx.datasetVersion.create({
      data: {
        datasetId: parsed.data.datasetId,
        version: parsed.data.version,
        description: parsed.data.description ?? null,
        frozenById: user.id,
        parentVersionId: dataset.currentVersionId,
        stats: {
          rowCount: conv.length,
          byLanguage: statsByLang,
          byPersona: statsByPersona,
          filter: { runId: parsed.data.filterRunId ?? null, status: parsed.data.filterStatus },
        },
      },
    });
    await tx.datasetVersionConversation.createMany({
      data: conv.map((c) => ({ datasetVersionId: v.id, conversationId: c.id })),
    });
    await tx.dataset.update({
      where: { id: parsed.data.datasetId },
      data: { currentVersionId: v.id },
    });
    return v;
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "dataset.freeze",
    targetKind: "DatasetVersion",
    targetId: versionRow.id,
    metadata: { version: versionRow.version, rowCount: conv.length },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/datasets/${parsed.data.datasetId}`);
  return { ok: true, versionId: versionRow.id };
}

export async function deleteDataset(projectId: string, datasetId: string) {
  const { user } = await requireProjectPermission(projectId, "datasets.freeze");

  const dataset = await prisma.dataset.findFirst({
    where: { id: datasetId, projectId },
    select: { id: true, name: true, currentVersionId: true },
  });
  if (!dataset) return { error: "Dataset not found in this project" };

  // Clear the self-reference first so the cascade to DatasetVersion (and from
  // there to DatasetVersionConversation + ExportArtifact) doesn't trip the
  // pinned-current-version FK.
  try {
    await prisma.$transaction(async (tx) => {
      if (dataset.currentVersionId) {
        await tx.dataset.update({
          where: { id: datasetId },
          data: { currentVersionId: null },
        });
      }
      await tx.dataset.delete({ where: { id: datasetId } });
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "dataset.delete",
    targetKind: "Dataset",
    targetId: datasetId,
    metadata: { name: dataset.name },
  });

  revalidatePath(`/projects/${projectId}/datasets`);
  return { ok: true };
}

const exportSchema = z.object({
  projectId: z.string(),
  versionId: z.string(),
  format: z.enum(["openai-jsonl", "function-call-bench"]).default("openai-jsonl"),
});

export async function buildDatasetExport(input: z.infer<typeof exportSchema>) {
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "datasets.export");

  const version = await prisma.datasetVersion.findUniqueOrThrow({
    where: { id: parsed.data.versionId },
    include: { dataset: { select: { id: true, projectId: true, name: true } } },
  });
  if (version.dataset.projectId !== parsed.data.projectId) {
    return { error: "Mismatched project" };
  }

  // Reserve an artifact path the worker will write to.
  const safeDataset = version.dataset.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
  const safeVersion = version.version.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 40);
  // Filename suffix encodes the format so multiple exports on the same version are
  // distinguishable by name alone.
  const suffix = parsed.data.format === "function-call-bench" ? "fcbench.jsonl" : "openai.jsonl";
  const storagePath = `${parsed.data.projectId}/${safeDataset}-${safeVersion}-${Date.now()}-${suffix}`;

  const artifact = await prisma.exportArtifact.create({
    data: {
      datasetVersionId: parsed.data.versionId,
      format: parsed.data.format,
      storageKind: "local",
      storagePath,
      status: "building",
      createdById: user.id,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "export.create",
    targetKind: "ExportArtifact",
    targetId: artifact.id,
    metadata: { format: parsed.data.format, storagePath },
  });

  const built = await tryCall(() => buildExport(artifact.id), `build export ${artifact.id}`);
  if (!built) {
    await prisma.exportArtifact.update({
      where: { id: artifact.id },
      data: { status: "failed" },
    });
    return { error: "Synthgen worker unreachable — export did not build." };
  }

  revalidatePath(`/projects/${parsed.data.projectId}/datasets/${version.datasetId}`);
  return { ok: true, artifactId: artifact.id };
}
