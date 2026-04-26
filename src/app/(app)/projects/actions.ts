"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, requireUser } from "@/lib/rbac";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { bootstrapProjectDefaults, tryCall } from "@/lib/synthgen-api";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const createSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().or(z.literal("")).transform((v) => v || undefined),
});

export async function createProject(input: { name: string; description?: string }) {
  const user = await requirePermission("projects:write");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const baseSlug = slugify(parsed.data.name) || "project";
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.project.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${++suffix}`;
    if (suffix > 50) return { error: "Could not generate a unique slug" };
  }

  const project = await prisma.project.create({
    data: {
      slug,
      name: parsed.data.name,
      description: parsed.data.description,
      createdById: user.id,
      members: {
        create: { userId: user.id, role: "OWNER", addedById: user.id },
      },
    },
  });

  await logAudit({
    projectId: project.id,
    actorUserId: user.id,
    action: "project.create",
    targetKind: "Project",
    targetId: project.id,
    metadata: { name: project.name, slug: project.slug },
  });

  // Best-effort bootstrap of default LanguageProfiles via Python service.
  // If the worker is down at this moment we surface a soft warning rather than failing the create.
  const bootstrapped = await tryCall(
    () => bootstrapProjectDefaults(project.id),
    `bootstrap project ${project.id}`,
  );

  revalidatePath("/projects");
  return {
    ok: true as const,
    id: project.id,
    bootstrapWarning: bootstrapped
      ? null
      : "Project created, but default language profiles could not be seeded — the synthgen worker is offline. You can add them manually, or restart the worker and use ‘Reseed defaults’ in Settings.",
  };
}

const updateSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional().or(z.literal("")).transform((v) => v ?? undefined),
  defaultFormality: z.enum(["formal", "semi-formal", "colloquial", "mixed"]).optional(),
});

export async function updateProject(input: {
  projectId: string;
  name?: string;
  description?: string;
  defaultFormality?: string;
}) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "project.update");

  const { projectId, ...patch } = parsed.data;
  await prisma.project.update({ where: { id: projectId }, data: patch });

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "project.update",
    targetKind: "Project",
    targetId: projectId,
    metadata: patch,
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
  return { ok: true };
}

export async function archiveProject(projectId: string) {
  const { user } = await requireProjectPermission(projectId, "project.delete");
  await prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: new Date() },
  });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "project.archive",
    targetKind: "Project",
    targetId: projectId,
  });
  revalidatePath("/projects");
  return { ok: true };
}

const memberAddSchema = z.object({
  projectId: z.string(),
  email: z.string().email(),
  role: z.enum(["OWNER", "EDITOR", "ANNOTATOR", "VIEWER"]),
});

export async function addProjectMember(input: {
  projectId: string;
  email: string;
  role: "OWNER" | "EDITOR" | "ANNOTATOR" | "VIEWER";
}) {
  const parsed = memberAddSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "members.manage");

  const target = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!target) return { error: `No user found with email ${parsed.data.email}` };

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: parsed.data.projectId, userId: target.id } },
    update: { role: parsed.data.role },
    create: {
      projectId: parsed.data.projectId,
      userId: target.id,
      role: parsed.data.role,
      addedById: user.id,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "members.add",
    targetKind: "User",
    targetId: target.id,
    metadata: { email: parsed.data.email, role: parsed.data.role },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/members`);
  return { ok: true };
}

export async function removeProjectMember(projectId: string, userId: string) {
  const { user } = await requireProjectPermission(projectId, "members.manage");
  // Prevent removing the last OWNER.
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (member?.role === "OWNER") {
    const ownerCount = await prisma.projectMember.count({
      where: { projectId, role: "OWNER" },
    });
    if (ownerCount <= 1) {
      return { error: "Cannot remove the last OWNER. Transfer ownership first." };
    }
  }
  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId, userId } },
  });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "members.remove",
    targetKind: "User",
    targetId: userId,
  });
  revalidatePath(`/projects/${projectId}/members`);
  return { ok: true };
}

export async function reseedDefaults(projectId: string) {
  const { user } = await requireProjectPermission(projectId, "project.update");
  // Confirm user identity hasn't been stripped.
  await requireUser();
  const result = await tryCall(
    () => bootstrapProjectDefaults(projectId),
    `reseed project ${projectId}`,
  );
  if (!result) {
    return { error: "Synthgen worker unreachable. Try again once it is online." };
  }
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "project.reseed-defaults",
    targetKind: "Project",
    targetId: projectId,
    metadata: { created: result.created },
  });
  revalidatePath(`/projects/${projectId}/languages`);
  return { ok: true, created: result.created };
}
