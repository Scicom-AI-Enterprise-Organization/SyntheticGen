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

// Ensemble judge groups — a named list of {providerCredentialId, model} judges.
// A chat-replay benchmark run scores against one group; a group of size 1 is
// the "single judge" case, 2+ produces per-row consensus. Required to start a
// chat-replay benchmark run.

// GET /api/v1/projects/:projectId/ensemble-groups
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const groups = await prisma.ensembleJudgeGroup.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, judges: true, createdAt: true },
    });
    return Response.json({
      ensembleGroups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        judges: Array.isArray(g.judges) ? g.judges : [],
        createdAt: g.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/ensemble-groups — create a judge group.
// Mirrors `createEnsembleGroup`. Every judge's provider must be in the project.
const schema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  judges: z
    .array(
      z.object({
        providerCredentialId: z.string(),
        model: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(8),
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
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const { name, description, judges } = parsed.data;

    // Validate every judge's provider belongs to this project.
    const providerIds = Array.from(
      new Set(judges.map((j) => j.providerCredentialId)),
    );
    const owned = await prisma.providerCredential.findMany({
      where: { id: { in: providerIds }, projectId },
      select: { id: true },
    });
    const validIds = new Set(owned.map((p) => p.id));
    const bad = judges.find((j) => !validIds.has(j.providerCredentialId));
    if (bad) {
      return Response.json(
        { error: `Provider ${bad.providerCredentialId} not in this project` },
        { status: 400 },
      );
    }

    try {
      const created = await prisma.ensembleJudgeGroup.create({
        data: {
          projectId,
          name: name.trim(),
          description: description?.trim() || null,
          judges: judges as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, name: true },
      });
      await logAudit({
        projectId,
        actorUserId: user.id,
        action: "ensemble_group.create",
        targetKind: "EnsembleJudgeGroup",
        targetId: created.id,
        metadata: { name: created.name, judgeCount: judges.length, viaApi: true },
      });
      return Response.json(
        { ok: true, ensembleGroup: { ...created, judgeCount: judges.length } },
        { status: 201 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return Response.json(
          { error: `A group named "${name}" already exists in this project` },
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
