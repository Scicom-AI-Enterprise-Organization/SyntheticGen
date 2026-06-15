import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/datasets — list datasets + version counts.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "datasets.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const rows = await prisma.dataset.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        currentVersionId: true,
        createdAt: true,
        currentVersion: { select: { version: true } },
        _count: { select: { versions: true } },
      },
    });
    return Response.json({
      datasets: rows.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        currentVersionId: d.currentVersionId,
        currentVersion: d.currentVersion?.version ?? null,
        versionCount: d._count.versions,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/datasets — freeze a new dataset version.
// Snapshots a set of conversations (by filter or explicit ids) into an
// immutable DatasetVersion. Creates the parent Dataset on first freeze. The
// frozen conversations become delete-protected (DatasetVersionConversation FK
// is Restrict — see deleteConversation).
const filterSchema = z.object({
  runIds: z.array(z.string()).optional(),
  personaIds: z.array(z.string()).optional(),
  taxonomyNodeIds: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(20000).optional(),
});

const SEMVER = /^\d+\.\d+\.\d+$/;

const createSchema = z
  .object({
    name: z.string().min(2).max(120),
    description: z.string().max(500).optional().nullable(),
    version: z
      .string()
      .regex(SEMVER, "version must be semver, e.g. 0.1.0")
      .optional(),
    changelog: z.string().max(2000).optional().nullable(),
    filter: filterSchema.optional(),
    conversationIds: z.array(z.string()).optional(),
  })
  .refine((d) => d.filter || d.conversationIds, {
    message: "Provide either a filter or explicit conversationIds",
  });

function bumpPatch(version: string | null): string {
  if (!version || !SEMVER.test(version)) return "0.1.0";
  const [maj, min, pat] = version.split(".").map((n) => Number.parseInt(n, 10));
  return `${maj}.${min}.${pat + 1}`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "datasets.freeze");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const { name, description, changelog, filter, conversationIds } = parsed.data;

    // Resolve the conversation set to freeze.
    const where: Prisma.ConversationWhereInput = { projectId };
    if (conversationIds?.length) {
      where.id = { in: conversationIds };
    } else if (filter) {
      if (filter.runIds?.length) where.runId = { in: filter.runIds };
      if (filter.personaIds?.length) where.personaId = { in: filter.personaIds };
      if (filter.taxonomyNodeIds?.length)
        where.taxonomyNodeId = { in: filter.taxonomyNodeIds };
      if (filter.statuses?.length) where.status = { in: filter.statuses };
      else where.status = "accepted";
    }
    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: filter?.limit ?? 20000,
      select: { id: true, primaryLanguage: true, status: true, difficulty: true },
    });
    if (conversations.length === 0) {
      return Response.json(
        { error: "No conversations match — adjust the filter/ids and try again." },
        { status: 400 },
      );
    }

    // Freeze-time stats snapshot.
    const byLanguage: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byDifficulty: Record<string, number> = {};
    for (const c of conversations) {
      const lang = c.primaryLanguage ?? "unknown";
      byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      const diff = c.difficulty ?? "unknown";
      byDifficulty[diff] = (byDifficulty[diff] ?? 0) + 1;
    }
    const stats = {
      total: conversations.length,
      byLanguage,
      byStatus,
      byDifficulty,
    };

    // Find-or-create the Dataset, then version it. The freeze runs in a
    // transaction so a half-created version never lingers.
    try {
      const result = await prisma.$transaction(async (tx) => {
        const dataset =
          (await tx.dataset.findUnique({
            where: { projectId_name: { projectId, name } },
            select: { id: true, currentVersion: { select: { version: true } } },
          })) ??
          (await tx.dataset.create({
            data: { projectId, name, description: description ?? null },
            select: { id: true, currentVersion: { select: { version: true } } },
          }));

        const prevVersion = dataset.currentVersion?.version ?? null;
        const version = parsed.data.version ?? bumpPatch(prevVersion);

        const dv = await tx.datasetVersion.create({
          data: {
            datasetId: dataset.id,
            version,
            description: description ?? null,
            changelog: changelog ?? null,
            frozenById: user.id,
            stats: stats as unknown as Prisma.InputJsonValue,
          },
          select: { id: true, version: true },
        });

        await tx.datasetVersionConversation.createMany({
          data: conversations.map((c) => ({
            datasetVersionId: dv.id,
            conversationId: c.id,
          })),
        });

        // Pin as the dataset's current version.
        await tx.dataset.update({
          where: { id: dataset.id },
          data: { currentVersionId: dv.id },
        });

        return { datasetId: dataset.id, versionId: dv.id, version: dv.version };
      });

      await logAudit({
        projectId,
        actorUserId: user.id,
        action: "dataset.version.freeze",
        targetKind: "DatasetVersion",
        targetId: result.versionId,
        metadata: {
          datasetId: result.datasetId,
          name,
          version: result.version,
          itemCount: conversations.length,
          viaApi: true,
        },
      });

      return Response.json(
        {
          ok: true,
          dataset: { id: result.datasetId, name },
          version: {
            id: result.versionId,
            version: result.version,
            itemCount: conversations.length,
            stats,
          },
        },
        { status: 201 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return Response.json(
          {
            error:
              "That version already exists for this dataset — pass a higher `version` or omit it to auto-bump.",
          },
          { status: 409 },
        );
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
