import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  hasPermission,
  requireUserFromRequest,
} from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { bootstrapProjectDefaults, tryCall } from "@/lib/synthgen-api";

export const runtime = "nodejs";

// GET /api/v1/projects — list all projects the caller is a member of. Used
// by agents to discover what project ids they can debug.
export async function GET(req: Request) {
  try {
    const user = await requireUserFromRequest(req);
    const memberships = await prisma.projectMember.findMany({
      where: { userId: user.id },
      include: { project: true },
      orderBy: { project: { createdAt: "desc" } },
    });
    return Response.json({
      projects: memberships.map((m) => ({
        id: m.project.id,
        name: m.project.name,
        slug: m.project.slug,
        role: m.role,
        createdAt: m.project.createdAt,
      })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

const createSchema = z.object({
  name: z.string().min(2).max(120),
  description: z
    .string()
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || undefined),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// POST /api/v1/projects — create a project, owned by the caller. Mirrors
// `createProject` from src/app/(app)/projects/actions.ts.
export async function POST(req: Request) {
  try {
    const user = await requireUserFromRequest(req);
    if (!hasPermission(user, "projects:write")) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const base = slugify(parsed.data.name) || "project";
    let slug = base;
    let suffix = 1;
    while (await prisma.project.findUnique({ where: { slug } })) {
      slug = `${base}-${++suffix}`;
      if (suffix > 50) {
        return Response.json(
          { error: "Could not generate a unique slug" },
          { status: 409 },
        );
      }
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
      metadata: { name: project.name, slug: project.slug, viaApi: true },
    });
    const bootstrapped = await tryCall(
      () => bootstrapProjectDefaults(project.id),
      `bootstrap project ${project.id}`,
    );
    return Response.json(
      {
        ok: true,
        project: { id: project.id, name: project.name, slug: project.slug },
        bootstrapWarning: bootstrapped
          ? null
          : "Default language profiles could not be seeded — synthgen worker offline.",
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
