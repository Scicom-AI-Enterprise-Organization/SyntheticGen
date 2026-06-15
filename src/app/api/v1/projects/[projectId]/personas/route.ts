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
  description: z.string().max(2000).optional().nullable(),
  ethnicity: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  urbanity: z.enum(["urban", "suburban", "kampung"]).optional().nullable(),
  ageRange: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  occupation: z.string().optional().nullable(),
  formality: z
    .enum(["baku", "colloquial", "manglish", "mixed"])
    .optional()
    .nullable(),
  religionAware: z.boolean().default(false),
  dialectTags: z.array(z.string()).default([]),
  languageProfileId: z.string().optional().nullable(),
});

// GET — list project personas. POST — create one.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "personas.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });
    const rows = await prisma.persona.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        formality: true,
        ethnicity: true,
        region: true,
        urbanity: true,
        ageRange: true,
        languageProfileId: true,
      },
    });
    return Response.json({ personas: rows });
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
      "personas.write",
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
    const created = await prisma.persona.create({
      data: {
        projectId,
        name: d.name,
        description: d.description ?? null,
        ethnicity: d.ethnicity ?? null,
        region: d.region ?? null,
        urbanity: d.urbanity ?? null,
        ageRange: d.ageRange ?? null,
        gender: d.gender ?? null,
        occupation: d.occupation ?? null,
        formality: d.formality ?? null,
        religionAware: d.religionAware,
        dialectTags: d.dialectTags,
        languageProfileId: d.languageProfileId ?? null,
      },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "persona.create",
      targetKind: "Persona",
      targetId: created.id,
      metadata: { name: created.name, viaApi: true },
    });
    return Response.json({ ok: true, persona: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
