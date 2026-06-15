import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// PATCH /api/v1/projects/:projectId/languages/:languageId — partial update.
// Mirrors the update branch of `upsertLanguageProfile`.
const patchSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    primary: z.enum(["ms", "en", "zh", "ta"]).optional(),
    secondary: z.array(z.string()).optional(),
    script: z.enum(["latin", "jawi", "hans", "hant", "tamil"]).optional(),
    codeSwitchPolicy: z
      .enum(["none", "inter-sentential", "intra-sentential", "rojak"])
      .optional(),
    codeSwitchRate: z.number().min(0).max(1).optional().nullable(),
    register: z.enum(["formal", "semi-formal", "colloquial", "mixed"]).optional(),
    allowParticles: z.boolean().optional(),
    bannedTokens: z.array(z.string()).optional(),
    bannedPatterns: z.array(z.string()).optional(),
    requireFormalMalay: z.boolean().optional(),
    englishLoanwordPolicy: z.enum(["forbid", "allowlist", "free"]).optional(),
    loanwordAllowlist: z.array(z.string()).optional(),
    dialectHints: z.array(z.string()).optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; languageId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, languageId } = await params;
    const perm = await checkProjectPermission(user, projectId, "languages.write");
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

    const existing = await prisma.languageProfile.findFirst({
      where: { id: languageId, projectId },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.languageProfile.update({
      where: { id: languageId },
      data: parsed.data,
      select: { id: true, name: true },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "language-profile.update",
      targetKind: "LanguageProfile",
      targetId: languageId,
      metadata: { name: updated.name, viaApi: true },
    });
    return Response.json({ ok: true, languageProfile: updated });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// DELETE — refuses if any persona or run references the profile. Mirrors
// deleteLanguageProfile.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; languageId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId, languageId } = await params;
    const perm = await checkProjectPermission(user, projectId, "languages.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const existing = await prisma.languageProfile.findFirst({
      where: { id: languageId, projectId },
      select: { id: true },
    });
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

    const personaRefs = await prisma.persona.count({
      where: { languageProfileId: languageId },
    });
    if (personaRefs > 0) {
      return Response.json(
        { error: `Cannot delete: ${personaRefs} persona(s) reference this profile` },
        { status: 409 },
      );
    }
    const runRefs = await prisma.generationRun.count({
      where: { languageProfileId: languageId },
    });
    if (runRefs > 0) {
      return Response.json(
        { error: `Cannot delete: ${runRefs} run(s) reference this profile` },
        { status: 409 },
      );
    }

    await prisma.languageProfile.delete({ where: { id: languageId } });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "language-profile.delete",
      targetKind: "LanguageProfile",
      targetId: languageId,
      metadata: { viaApi: true },
    });
    return Response.json({ ok: true, id: languageId });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
