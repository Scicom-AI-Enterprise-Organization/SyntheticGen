import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "node"
  );
}

// Resolve the taxonomy to write into: the caller's explicit id (validated to
// belong to the project), else the project's oldest taxonomy, else a freshly
// created "default" one. Mirrors the bootstrap orchestrator's ensureTaxonomy.
async function resolveTaxonomyId(
  projectId: string,
  explicitId: string | null,
): Promise<{ ok: true; taxonomyId: string } | { ok: false; error: string }> {
  if (explicitId) {
    const t = await prisma.taxonomy.findFirst({
      where: { id: explicitId, projectId },
      select: { id: true },
    });
    if (!t) return { ok: false, error: "Taxonomy not found in this project" };
    return { ok: true, taxonomyId: t.id };
  }
  const existing = await prisma.taxonomy.findFirst({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return { ok: true, taxonomyId: existing.id };
  const created = await prisma.taxonomy.create({
    data: { projectId, name: "default", description: "Auto-created via API" },
  });
  return { ok: true, taxonomyId: created.id };
}

// GET /api/v1/projects/:projectId/taxonomy
// Flat list of every taxonomy node in the project (with its taxonomyId), plus
// the taxonomies themselves. These node ids are what `POST /runs` consumes as
// `taxonomyNodeIds`, so this is the discovery endpoint for run authoring.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "taxonomy.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const taxonomies = await prisma.taxonomy.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true },
    });
    const nodes = await prisma.taxonomyNode.findMany({
      where: { taxonomy: { projectId } },
      orderBy: [{ taxonomyId: "asc" }, { path: "asc" }],
      select: {
        id: true,
        taxonomyId: true,
        parentId: true,
        name: true,
        slug: true,
        path: true,
        depth: true,
      },
    });
    return Response.json({ taxonomies, taxonomyNodes: nodes });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/taxonomy — create a (flat, slice-1) node.
// `taxonomyId` is optional; omit it to use the project's default taxonomy
// (auto-created if the project has none). Mirrors createTaxonomyNode.
const createSchema = z.object({
  name: z.string().min(1).max(120),
  taxonomyId: z.string().optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "taxonomy.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const resolved = await resolveTaxonomyId(
      projectId,
      parsed.data.taxonomyId ?? null,
    );
    if (!resolved.ok) {
      return Response.json({ error: resolved.error }, { status: 400 });
    }
    const taxonomyId = resolved.taxonomyId;

    const name = parsed.data.name.trim();
    const slug = slugify(name);
    // Slice 1: flat tree, parent always null. Dedup on the (taxonomy, parent,
    // slug) unique constraint so a repeated name 409s cleanly.
    const dup = await prisma.taxonomyNode.findFirst({
      where: { taxonomyId, parentId: null, slug },
      select: { id: true },
    });
    if (dup) {
      return Response.json(
        { error: "A node with this name already exists in the taxonomy" },
        { status: 409 },
      );
    }

    const created = await prisma.taxonomyNode.create({
      data: {
        taxonomyId,
        parentId: null,
        name,
        slug,
        path: `/${slug}`,
        depth: 1,
      },
      select: {
        id: true,
        taxonomyId: true,
        parentId: true,
        name: true,
        slug: true,
        path: true,
        depth: true,
      },
    });

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "taxonomy.node.create",
      targetKind: "TaxonomyNode",
      targetId: created.id,
      metadata: { name: created.name, path: created.path, viaApi: true },
    });

    return Response.json({ ok: true, taxonomyNode: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
