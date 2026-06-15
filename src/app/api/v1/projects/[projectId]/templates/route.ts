import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().min(2).max(120),
  kind: z
    .enum(["system", "user-seed", "judge", "conversation-driver"])
    .default("user-seed"),
  description: z.string().max(2000).optional().nullable(),
  body: z.string().min(1).max(50000),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "templates.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });
    const rows = await prisma.promptTemplate.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, description: true },
    });
    return Response.json({ templates: rows });
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
    const perm = await checkProjectPermission(
      user,
      projectId,
      "templates.write",
    );
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
    const created = await prisma.promptTemplate.create({
      data: {
        projectId,
        name: d.name,
        kind: d.kind,
        description: d.description ?? null,
        body: d.body,
      },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "template.create",
      targetKind: "PromptTemplate",
      targetId: created.id,
      metadata: { name: created.name, kind: created.kind, viaApi: true },
    });
    return Response.json({ ok: true, template: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
