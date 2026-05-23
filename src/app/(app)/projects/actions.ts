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
  // Labeling platform connection. Empty string on `labelingApiKey`
  // means "clear it"; undefined means "keep existing".
  labelingBaseUrl: z.string().url().optional().or(z.literal("")),
  labelingApiKey: z.string().optional(),
});

export async function updateProject(input: {
  projectId: string;
  name?: string;
  description?: string;
  defaultFormality?: string;
  labelingBaseUrl?: string;
  labelingApiKey?: string;
}) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "project.update");

  const { projectId, labelingBaseUrl, labelingApiKey, ...rest } = parsed.data;

  // Build the patch — separate the labeling fields because the key is
  // encrypted, and "" means "clear" while undefined means "keep".
  const patch: Record<string, unknown> = { ...rest };
  if (labelingBaseUrl !== undefined) {
    patch.labelingBaseUrl = labelingBaseUrl === "" ? null : labelingBaseUrl;
  }
  if (labelingApiKey !== undefined) {
    if (labelingApiKey === "") {
      patch.labelingApiKeyEnc = null;
    } else {
      // Lazy import so the encryption crypto stays out of edge bundles.
      const { encryptSecret } = await import("@/lib/crypto");
      patch.labelingApiKeyEnc = encryptSecret(labelingApiKey);
    }
  }

  await prisma.project.update({ where: { id: projectId }, data: patch });

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "project.update",
    targetKind: "Project",
    targetId: projectId,
    // Don't log the API key itself in the audit metadata — just mark
    // whether it was set/cleared.
    metadata: {
      ...rest,
      ...(labelingBaseUrl !== undefined && { labelingBaseUrl }),
      ...(labelingApiKey !== undefined && {
        labelingApiKey: labelingApiKey === "" ? "<cleared>" : "<set>",
      }),
    },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
  return { ok: true };
}

// Quick connectivity check for the labeling-platform settings card.
// Performs a GET against the platform's projects-list endpoint with
// the supplied credentials (or the stored ones if absent) so the user
// can confirm URL + token work BEFORE saving. Returns a short status
// string suitable for inline rendering.
const testLabelingSchema = z.object({
  projectId: z.string(),
  // Both optional — fall back to stored values when missing.
  labelingBaseUrl: z.string().url().optional().or(z.literal("")),
  labelingApiKey: z.string().optional(),
});

export async function testLabelingConnection(
  input: z.infer<typeof testLabelingSchema>,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const parsed = testLabelingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  await requireProjectPermission(parsed.data.projectId, "project.update");

  // Resolve URL + token from the form first, then fall back to stored
  // project values.
  let url = parsed.data.labelingBaseUrl;
  let token = parsed.data.labelingApiKey;
  if (!url || !token) {
    const projectRow = await prisma.project.findUnique({
      where: { id: parsed.data.projectId },
      select: { labelingBaseUrl: true, labelingApiKeyEnc: true },
    });
    if (!url) url = projectRow?.labelingBaseUrl ?? undefined;
    if (!token && projectRow?.labelingApiKeyEnc) {
      const { decryptSecret } = await import("@/lib/crypto");
      token = decryptSecret(projectRow.labelingApiKeyEnc as unknown as Buffer);
    }
  }
  if (!url || url === "") return { ok: false, error: "No labeling URL — type one or save it first." };
  if (!token) return { ok: false, error: "No labeling token — type one or save it first." };

  const cleanUrl = url.replace(/\/$/, "");
  try {
    // Brief timeout so a wrong URL doesn't hang the UI.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    // `/api/auth/me` is the platform's "who am I" endpoint — lightweight
    // and specifically intended for token verification.
    const res = await fetch(`${cleanUrl}/api/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Auth failed (HTTP ${res.status}) — token rejected by ${cleanUrl}.` };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${res.status} from ${cleanUrl}/api/auth/me${body ? ` — ${body.slice(0, 120)}` : ""}`,
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      user?: { email?: string; name?: string };
      email?: string;
      name?: string;
      id?: string;
    };
    // Different platforms shape /me differently — surface whatever
    // identifying field we can find.
    const who =
      json.user?.email ??
      json.user?.name ??
      json.email ??
      json.name ??
      json.id ??
      "authenticated";
    return {
      ok: true,
      message: `Connected to ${cleanUrl} — token valid (as ${who}).`,
    };
  } catch (e) {
    const msg = (e as Error).message ?? "unknown";
    return {
      ok: false,
      error: msg.includes("aborted")
        ? `Timed out connecting to ${cleanUrl} (10s).`
        : `Failed to reach ${cleanUrl}: ${msg.slice(0, 160)}`,
    };
  }
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
