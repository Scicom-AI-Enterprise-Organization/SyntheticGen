"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { encryptSecret, fingerprintApiKey } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120),
  kind: z.enum(["openai", "vllm", "together", "openrouter", "sglang", "anthropic-proxy", "custom"]),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  defaultModel: z.string().max(120).optional().nullable(),
});

export async function createProvider(input: z.infer<typeof createSchema>) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "providers.manage");

  let encrypted: Buffer;
  try {
    encrypted = encryptSecret(parsed.data.apiKey);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const created = await prisma.providerCredential.create({
    data: {
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      baseUrl: parsed.data.baseUrl,
      encryptedApiKey: new Uint8Array(encrypted),
      keyFingerprint: fingerprintApiKey(parsed.data.apiKey),
      defaultModel: parsed.data.defaultModel ?? null,
      createdById: user.id,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "provider.create",
    targetKind: "ProviderCredential",
    targetId: created.id,
    metadata: { name: created.name, kind: created.kind, baseUrl: created.baseUrl },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/providers`);
  return { ok: true };
}

export async function deleteProvider(projectId: string, id: string) {
  const { user } = await requireProjectPermission(projectId, "providers.manage");
  const refCount = await prisma.generationRun.count({
    where: { providerCredentialId: id },
  });
  if (refCount > 0) {
    return { error: `Cannot delete: ${refCount} run(s) reference this provider` };
  }
  await prisma.providerCredential.delete({ where: { id } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "provider.delete",
    targetKind: "ProviderCredential",
    targetId: id,
  });
  revalidatePath(`/projects/${projectId}/providers`);
  return { ok: true };
}
