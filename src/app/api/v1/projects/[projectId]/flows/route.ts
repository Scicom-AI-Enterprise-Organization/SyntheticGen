import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// Minimal create — matches what the /flows/new dialog does (name + optional
// description, no nodes yet). Use PATCH on the flow detail to populate
// nodes / edges / publish.
const schema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "flows.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });
    const rows = await prisma.flow.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        version: true,
        isPublished: true,
      },
    });
    return Response.json({ flows: rows });
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
    const perm = await checkProjectPermission(user, projectId, "flows.write");
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
    const created = await prisma.flow.create({
      data: {
        projectId,
        name: d.name,
        description: d.description ?? null,
        nodes: [],
        edges: [],
      },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "flow.create",
      targetKind: "Flow",
      targetId: created.id,
      metadata: { name: created.name, viaApi: true },
    });
    return Response.json({ ok: true, flow: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
