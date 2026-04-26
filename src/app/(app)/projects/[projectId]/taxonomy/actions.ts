"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "node";
}

const createNodeSchema = z.object({
  projectId: z.string(),
  taxonomyId: z.string(),
  name: z.string().min(1).max(120),
});

export async function createTaxonomyNode(input: z.infer<typeof createNodeSchema>) {
  const parsed = createNodeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "taxonomy.write");

  const slug = slugify(parsed.data.name);
  // Slice 1: flat tree, parent always null.
  const created = await prisma.taxonomyNode.create({
    data: {
      taxonomyId: parsed.data.taxonomyId,
      parentId: null,
      name: parsed.data.name,
      slug,
      path: `/${slug}`,
      depth: 1,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "taxonomy.node.create",
    targetKind: "TaxonomyNode",
    targetId: created.id,
    metadata: { name: created.name, path: created.path },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/taxonomy`);
  return { ok: true };
}

export async function deleteTaxonomyNode(projectId: string, id: string) {
  const { user } = await requireProjectPermission(projectId, "taxonomy.write");
  await prisma.taxonomyNode.delete({ where: { id } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "taxonomy.node.delete",
    targetKind: "TaxonomyNode",
    targetId: id,
  });
  revalidatePath(`/projects/${projectId}/taxonomy`);
  return { ok: true };
}
