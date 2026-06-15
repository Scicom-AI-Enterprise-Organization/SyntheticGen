import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const axisSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z][a-z0-9_]*$/, "key must be lowercase snake_case"),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(1000),
  scale: z.number().int().min(2).max(10),
  weight: z.number().min(0).max(10),
});

const schema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional().nullable(),
  axes: z.array(axisSchema).min(1).max(10),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "benchmarks.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });
    const rows = await prisma.rubric.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, axes: true },
    });
    return Response.json({ rubrics: rows });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

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
    const d = parsed.data;
    const created = await prisma.rubric.create({
      data: {
        projectId,
        name: d.name,
        description: d.description ?? null,
        axes: d.axes,
        createdById: user.id,
      },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "rubric.create",
      targetKind: "Rubric",
      targetId: created.id,
      metadata: { name: created.name, viaApi: true },
    });
    return Response.json({ ok: true, rubric: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
