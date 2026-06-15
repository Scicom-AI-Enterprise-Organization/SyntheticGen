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

// GET /api/v1/projects/:projectId/benchmarks — list benchmarks.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const rows = await prisma.benchmark.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        kind: true,
        source: true,
        splits: true,
        frozenConversationIds: true,
        defaultRubricId: true,
        defaultEnsembleGroupId: true,
        config: true,
        createdAt: true,
        _count: { select: { runs: true } },
      },
    });
    return Response.json({
      benchmarks: rows.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        kind: b.kind,
        source: b.source,
        splits: b.splits,
        mode:
          b.config && typeof b.config === "object" && "mode" in b.config
            ? (b.config as { mode?: string }).mode ?? null
            : null,
        itemCount: b.frozenConversationIds.length,
        defaultRubricId: b.defaultRubricId,
        defaultEnsembleGroupId: b.defaultEnsembleGroupId,
        runCount: b._count.runs,
        createdAt: b.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/benchmarks — create a project-chat-replay
// benchmark. Freezes the matching conversation set at create time. Mirrors the
// `createBenchmark` server action.
const filterSchema = z.object({
  runIds: z.array(z.string()).optional(),
  personaIds: z.array(z.string()).optional(),
  taxonomyNodeIds: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  seed: z.number().int().optional(),
});

const createSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  mode: z.enum(["single-turn", "multi-turn"]),
  filter: filterSchema.default({}),
  defaultRubricId: z.string().optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const { name, description, mode, filter, defaultRubricId } = parsed.data;

    const where: Prisma.ConversationWhereInput = { projectId };
    if (filter.runIds?.length) where.runId = { in: filter.runIds };
    if (filter.personaIds?.length) where.personaId = { in: filter.personaIds };
    if (filter.taxonomyNodeIds?.length)
      where.taxonomyNodeId = { in: filter.taxonomyNodeIds };
    if (filter.statuses?.length) where.status = { in: filter.statuses };
    else where.status = "accepted";

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: filter.limit ?? 200,
      select: { id: true, primaryLanguage: true },
    });
    if (conversations.length === 0) {
      return Response.json(
        { error: "No conversations match the filter — adjust and try again." },
        { status: 400 },
      );
    }
    if (defaultRubricId) {
      const rubric = await prisma.rubric.findFirst({
        where: { id: defaultRubricId, projectId },
        select: { id: true },
      });
      if (!rubric) {
        return Response.json(
          { error: "Selected rubric not found in this project" },
          { status: 400 },
        );
      }
    }

    const splits = Array.from(
      new Set(conversations.map((c) => c.primaryLanguage ?? "unknown")),
    ).sort();

    try {
      const created = await prisma.benchmark.create({
        data: {
          projectId,
          kind: "project-chat-replay",
          name,
          description: description ?? null,
          source:
            filter.runIds?.length === 1
              ? `project-run:${filter.runIds[0]}`
              : "project-filter",
          splits,
          maxRowsPerSplit: null,
          config: {
            kind: "chat-replay",
            mode,
            filter,
          } as unknown as Prisma.InputJsonValue,
          frozenConversationIds: conversations.map((c) => c.id),
          defaultRubricId: defaultRubricId ?? null,
          createdById: user.id,
        },
        select: { id: true, name: true, kind: true },
      });

      await logAudit({
        projectId,
        actorUserId: user.id,
        action: "benchmark.create",
        targetKind: "Benchmark",
        targetId: created.id,
        metadata: {
          name: created.name,
          mode,
          itemCount: conversations.length,
          viaApi: true,
        },
      });

      return Response.json(
        {
          ok: true,
          benchmark: { ...created, itemCount: conversations.length },
        },
        { status: 201 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return Response.json(
          { error: `A benchmark named "${name}" already exists in this project` },
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
