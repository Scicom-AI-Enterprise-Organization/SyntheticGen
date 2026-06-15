import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/knowledge — list knowledge-base entries.
// ?full=true returns the entry content (otherwise omitted for brevity).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "knowledge.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const full = new URL(req.url).searchParams.get("full") === "true";
    const rows = await prisma.knowledgeBaseEntry.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        tags: true,
        taxonomyNodeIds: true,
        sourceUrl: true,
        createdAt: true,
        ...(full ? { content: true } : {}),
      },
    });
    return Response.json({
      entries: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/knowledge — create one entry, or many when
// `entries` is provided (bulk). Mirrors createKnowledgeEntry /
// bulkCreateKnowledgeEntries. Requires knowledge.write.
const oneSchema = z.object({
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(50_000),
  tags: z.array(z.string()).default([]),
  taxonomyNodeIds: z.array(z.string()).default([]),
  sourceUrl: z.string().url().optional().nullable(),
});
const bulkSchema = z.object({
  tags: z.array(z.string()).default([]),
  taxonomyNodeIds: z.array(z.string()).default([]),
  entries: z
    .array(
      z.object({
        title: z.string().min(1).max(240),
        content: z.string().min(1).max(50_000),
        sourceUrl: z.string().url().optional().nullable(),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "knowledge.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);

    // Bulk path when `entries` array is present.
    if (body && typeof body === "object" && Array.isArray((body as { entries?: unknown }).entries)) {
      const parsed = bulkSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json(
          { error: parsed.error.errors[0]?.message ?? "Invalid input" },
          { status: 400 },
        );
      }
      const result = await prisma.knowledgeBaseEntry.createMany({
        data: parsed.data.entries.map((e) => ({
          projectId,
          title: e.title.slice(0, 240),
          content: e.content,
          tags: parsed.data.tags,
          taxonomyNodeIds: parsed.data.taxonomyNodeIds,
          sourceUrl: e.sourceUrl ?? null,
          createdById: user.id,
        })),
      });
      await logAudit({
        projectId,
        actorUserId: user.id,
        action: "knowledge.bulkCreate",
        targetKind: "KnowledgeBaseEntry",
        targetId: projectId,
        metadata: { count: result.count, viaApi: true },
      });
      return Response.json({ ok: true, count: result.count }, { status: 201 });
    }

    const parsed = oneSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const created = await prisma.knowledgeBaseEntry.create({
      data: {
        projectId,
        title: parsed.data.title,
        content: parsed.data.content,
        tags: parsed.data.tags,
        taxonomyNodeIds: parsed.data.taxonomyNodeIds,
        sourceUrl: parsed.data.sourceUrl ?? null,
        createdById: user.id,
      },
      select: { id: true, title: true },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "knowledge.create",
      targetKind: "KnowledgeBaseEntry",
      targetId: created.id,
      metadata: { title: created.title, viaApi: true },
    });
    return Response.json({ ok: true, entry: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
