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
  primary: z.enum(["ms", "en", "zh", "ta"]),
  secondary: z.array(z.string()).default([]),
  script: z
    .enum(["latin", "jawi", "hans", "hant", "tamil"])
    .default("latin"),
  codeSwitchPolicy: z
    .enum(["none", "inter-sentential", "intra-sentential", "rojak"])
    .default("none"),
  codeSwitchRate: z.number().min(0).max(1).nullable().optional(),
  register: z
    .enum(["formal", "semi-formal", "colloquial", "mixed"])
    .default("formal"),
  allowParticles: z.boolean().default(false),
  bannedTokens: z.array(z.string()).default([]),
  bannedPatterns: z.array(z.string()).default([]),
  requireFormalMalay: z.boolean().default(false),
  englishLoanwordPolicy: z
    .enum(["forbid", "allowlist", "free"])
    .default("free"),
  loanwordAllowlist: z.array(z.string()).default([]),
  dialectHints: z.array(z.string()).default([]),
  notes: z.string().max(2000).optional().nullable(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(
      user,
      projectId,
      "languages.read",
    );
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });
    const rows = await prisma.languageProfile.findMany({
      where: { projectId },
      orderBy: [{ isPreset: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        primary: true,
        register: true,
        allowParticles: true,
        script: true,
        isPreset: true,
      },
    });
    return Response.json({ languageProfiles: rows });
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
      "languages.write",
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
    const created = await prisma.languageProfile.create({
      data: {
        projectId,
        name: d.name,
        primary: d.primary,
        secondary: d.secondary,
        script: d.script,
        codeSwitchPolicy: d.codeSwitchPolicy,
        codeSwitchRate: d.codeSwitchRate ?? null,
        register: d.register,
        allowParticles: d.allowParticles,
        bannedTokens: d.bannedTokens,
        bannedPatterns: d.bannedPatterns,
        requireFormalMalay: d.requireFormalMalay,
        englishLoanwordPolicy: d.englishLoanwordPolicy,
        loanwordAllowlist: d.loanwordAllowlist,
        dialectHints: d.dialectHints,
        notes: d.notes ?? null,
      },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "languageProfile.create",
      targetKind: "LanguageProfile",
      targetId: created.id,
      metadata: { name: created.name, viaApi: true },
    });
    return Response.json(
      { ok: true, languageProfile: created },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
