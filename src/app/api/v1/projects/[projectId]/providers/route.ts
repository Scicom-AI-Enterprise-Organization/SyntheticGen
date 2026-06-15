import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { encryptSecret, fingerprintApiKey } from "@/lib/crypto";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().min(2).max(120),
  kind: z.enum([
    "openai",
    "vllm",
    "together",
    "openrouter",
    "sglang",
    "anthropic-proxy",
    "custom",
  ]),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  defaultModel: z.string().max(120).optional().nullable(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional().nullable(),
  chatTemplateKwargs: z.record(z.unknown()).optional().nullable(),
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
      "providers.manage",
    );
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });
    const rows = await prisma.providerCredential.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        kind: true,
        baseUrl: true,
        defaultModel: true,
        keyFingerprint: true,
        reasoningEffort: true,
      },
    });
    return Response.json({ providers: rows });
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
      "providers.manage",
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
    const encrypted = encryptSecret(d.apiKey);
    const created = await prisma.providerCredential.create({
      data: {
        projectId,
        name: d.name,
        kind: d.kind,
        baseUrl: d.baseUrl,
        // Match the existing action's coercion — wraps the Node Buffer in
        // a Uint8Array so Prisma's Bytes column accepts it cleanly.
        encryptedApiKey: new Uint8Array(encrypted),
        keyFingerprint: fingerprintApiKey(d.apiKey),
        defaultModel: d.defaultModel ?? null,
        reasoningEffort: d.reasoningEffort ?? null,
        chatTemplateKwargs:
          (d.chatTemplateKwargs as object | null | undefined) ?? undefined,
        createdById: user.id,
      },
      select: {
        id: true,
        name: true,
        kind: true,
        baseUrl: true,
        defaultModel: true,
        keyFingerprint: true,
      },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "provider.create",
      targetKind: "ProviderCredential",
      targetId: created.id,
      metadata: { name: created.name, kind: created.kind, viaApi: true },
    });
    return Response.json({ ok: true, provider: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
