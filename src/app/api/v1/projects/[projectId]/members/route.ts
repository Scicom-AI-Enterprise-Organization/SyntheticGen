import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// GET /api/v1/projects/:projectId/members — list members + roles.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "members.manage");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      orderBy: { role: "asc" },
      select: {
        userId: true,
        role: true,
        addedAt: true,
        user: { select: { email: true, name: true } },
      },
    });
    return Response.json({
      members: members.map((m) => ({
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        addedAt: m.addedAt?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/members — add or re-role a member by email.
// Mirrors `addProjectMember`. Requires members.manage.
const schema = z.object({
  email: z.string().email(),
  role: z.enum(["OWNER", "EDITOR", "ANNOTATOR", "VIEWER"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "members.manage");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const target = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    });
    if (!target) {
      return Response.json(
        { error: `No user found with email ${parsed.data.email}` },
        { status: 404 },
      );
    }

    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: target.id } },
      update: { role: parsed.data.role },
      create: {
        projectId,
        userId: target.id,
        role: parsed.data.role,
        addedById: user.id,
      },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "members.add",
      targetKind: "User",
      targetId: target.id,
      metadata: { email: parsed.data.email, role: parsed.data.role, viaApi: true },
    });
    return Response.json(
      { ok: true, member: { userId: target.id, role: parsed.data.role } },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
