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

// PATCH /api/v1/projects/:projectId/personas/:personaId — partial update.
// Only the fields you send change; pass null to clear a nullable field.
// Mirrors `updatePersona`.
const patchSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
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
    religionAware: z.boolean().optional(),
    dialectTags: z.array(z.string()).optional(),
    languageProfileId: z.string().optional().nullable(),
  })
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; personaId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, personaId } = await params;
    const perm = await checkProjectPermission(user, projectId, "personas.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    if (Object.keys(parsed.data).length === 0) {
      return Response.json({ error: "No fields to update" }, { status: 400 });
    }

    const existing = await prisma.persona.findFirst({
      where: { id: personaId, projectId },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.persona.update({
      where: { id: personaId },
      data: parsed.data,
      select: { id: true, name: true },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "persona.update",
      targetKind: "Persona",
      targetId: personaId,
      metadata: { name: updated.name, viaApi: true },
    });
    return Response.json({ ok: true, persona: updated });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE /api/v1/projects/:projectId/personas/:personaId — mirrors deletePersona.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; personaId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, personaId } = await params;
    const perm = await checkProjectPermission(user, projectId, "personas.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const existing = await prisma.persona.findFirst({
      where: { id: personaId, projectId },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    try {
      await prisma.persona.delete({ where: { id: personaId } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2003"
      ) {
        return Response.json(
          { error: "Persona is referenced elsewhere and can't be deleted." },
          { status: 409 },
        );
      }
      throw e;
    }
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "persona.delete",
      targetKind: "Persona",
      targetId: personaId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, id: personaId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
