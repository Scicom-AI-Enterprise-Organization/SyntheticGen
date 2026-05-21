"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { encryptSecret, decryptSecret, fingerprintApiKey } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

const reasoningEffortEnum = z.enum(["minimal", "low", "medium", "high"]);
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const chatTemplateKwargsSchema = z.record(z.string().min(1), jsonValueSchema);

const createSchema = z.object({
  projectId: z.string(),
  name: z.string().min(2).max(120),
  kind: z.enum(["openai", "vllm", "together", "openrouter", "sglang", "anthropic-proxy", "custom"]),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  defaultModel: z.string().max(120).optional().nullable(),
  reasoningEffort: reasoningEffortEnum.optional().nullable(),
  chatTemplateKwargs: chatTemplateKwargsSchema.optional().nullable(),
});

const testSchema = z.object({
  projectId: z.string(),
  // When `id` is set and `apiKey` is empty, the action falls back to the stored
  // (decrypted) key. This lets the edit dialog test changes without forcing the
  // user to retype the secret.
  id: z.string().optional().nullable(),
  baseUrl: z.string().url(),
  apiKey: z.string().optional().nullable(),
  model: z.string().min(1),
  reasoningEffort: reasoningEffortEnum.optional().nullable(),
  chatTemplateKwargs: chatTemplateKwargsSchema.optional().nullable(),
});

const updateSchema = z.object({
  projectId: z.string(),
  id: z.string(),
  name: z.string().min(2).max(120),
  kind: z.enum(["openai", "vllm", "together", "openrouter", "sglang", "anthropic-proxy", "custom"]),
  baseUrl: z.string().url(),
  // Optional on update — empty means "keep the existing key".
  apiKey: z.string().optional().nullable(),
  defaultModel: z.string().max(120).optional().nullable(),
  reasoningEffort: reasoningEffortEnum.optional().nullable(),
  chatTemplateKwargs: chatTemplateKwargsSchema.optional().nullable(),
});

export async function testProviderConnection(input: z.infer<typeof testSchema>) {
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  await requireProjectPermission(parsed.data.projectId, "providers.manage");

  let apiKey = parsed.data.apiKey ?? "";
  if (!apiKey) {
    if (!parsed.data.id) {
      return { error: "API key is required to test a new provider" };
    }
    const stored = await prisma.providerCredential.findFirst({
      where: { id: parsed.data.id, projectId: parsed.data.projectId },
      select: { encryptedApiKey: true },
    });
    if (!stored) return { error: "Provider not found in this project" };
    try {
      apiKey = decryptSecret(Buffer.from(stored.encryptedApiKey));
    } catch (e) {
      return { error: `Could not decrypt stored key: ${(e as Error).message}` };
    }
  }

  const url = parsed.data.baseUrl.replace(/\/$/, "") + "/chat/completions";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const body: Record<string, unknown> = {
      model: parsed.data.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      temperature: 0,
    };
    if (parsed.data.reasoningEffort) body.reasoning_effort = parsed.data.reasoningEffort;
    const ctk = parsed.data.chatTemplateKwargs ?? null;
    if (ctk && Object.keys(ctk).length > 0) {
      body.chat_template_kwargs = ctk;
      // Mirror to top-level include_reasoning when the user set enable_thinking —
      // vLLM Qwen3 needs both for thinking to be fully suppressed.
      if ("enable_thinking" in ctk) {
        body.include_reasoning = Boolean(ctk.enable_thinking);
      }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      return { error: `Non-JSON response: ${text.slice(0, 200)}` };
    }
    const choices = (parsedJson as { choices?: unknown[] }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return { error: "Response missing 'choices' array" };
    }
    return { ok: true };
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") return { error: "Request timed out after 15s" };
    return { error: err.message || "Network error" };
  } finally {
    clearTimeout(timer);
  }
}

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
      reasoningEffort: parsed.data.reasoningEffort ?? null,
      chatTemplateKwargs:
        parsed.data.chatTemplateKwargs && Object.keys(parsed.data.chatTemplateKwargs).length > 0
          ? (parsed.data.chatTemplateKwargs as Prisma.InputJsonValue)
          : Prisma.JsonNull,
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

export async function updateProvider(input: z.infer<typeof updateSchema>) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "providers.manage");

  const existing = await prisma.providerCredential.findFirst({
    where: { id: parsed.data.id, projectId: parsed.data.projectId },
    select: { id: true, name: true },
  });
  if (!existing) return { error: "Provider not found in this project" };

  const data: Prisma.ProviderCredentialUpdateInput = {
    name: parsed.data.name,
    kind: parsed.data.kind,
    baseUrl: parsed.data.baseUrl,
    defaultModel: parsed.data.defaultModel ?? null,
    reasoningEffort: parsed.data.reasoningEffort ?? null,
    chatTemplateKwargs:
      parsed.data.chatTemplateKwargs && Object.keys(parsed.data.chatTemplateKwargs).length > 0
        ? (parsed.data.chatTemplateKwargs as Prisma.InputJsonValue)
        : Prisma.JsonNull,
  };

  const newKey = parsed.data.apiKey?.trim();
  if (newKey) {
    let encrypted: Buffer;
    try {
      encrypted = encryptSecret(newKey);
    } catch (e) {
      return { error: (e as Error).message };
    }
    data.encryptedApiKey = new Uint8Array(encrypted);
    data.keyFingerprint = fingerprintApiKey(newKey);
  }

  await prisma.providerCredential.update({
    where: { id: parsed.data.id },
    data,
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "provider.update",
    targetKind: "ProviderCredential",
    targetId: parsed.data.id,
    metadata: {
      name: parsed.data.name,
      kind: parsed.data.kind,
      baseUrl: parsed.data.baseUrl,
      apiKeyRotated: Boolean(newKey),
    },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/providers`);
  return { ok: true };
}

// Copies one-or-more GlobalProviderCredential rows into this project as
// fresh ProviderCredential rows. The copy is a deep clone: encryptedApiKey,
// keyFingerprint, defaultModel, headers, reasoningEffort, chatTemplateKwargs
// — everything — so the project provider is fully independent and edits
// don't bleed back to the global. The `sourceGlobalProviderId` link is kept
// purely for tracing ("imported from <X>" / future "refresh from global").
const importSchema = z.object({
  projectId: z.string(),
  globalProviderIds: z.array(z.string()).min(1).max(50),
});

export async function importGlobalProviders(
  input: z.infer<typeof importSchema>,
) {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(
    parsed.data.projectId,
    "providers.manage",
  );

  const globals = await prisma.globalProviderCredential.findMany({
    where: { id: { in: parsed.data.globalProviderIds }, archivedAt: null },
  });
  if (globals.length === 0) {
    return { error: "Selected global providers not found" };
  }

  // Resolve name collisions per-project: if a row with the same name already
  // exists, append " (imported)" — and if that's also taken, " (imported 2)"
  // and so on. Keeps the (projectId, name) unique constraint happy.
  const existingNames = new Set(
    (
      await prisma.providerCredential.findMany({
        where: { projectId: parsed.data.projectId },
        select: { name: true },
      })
    ).map((p) => p.name),
  );
  function uniqueName(base: string): string {
    if (!existingNames.has(base)) {
      existingNames.add(base);
      return base;
    }
    let i = 1;
    while (true) {
      const candidate = i === 1 ? `${base} (imported)` : `${base} (imported ${i})`;
      if (!existingNames.has(candidate)) {
        existingNames.add(candidate);
        return candidate;
      }
      i++;
    }
  }

  const created: { id: string; name: string }[] = [];
  for (const g of globals) {
    const name = uniqueName(g.name);
    const row = await prisma.providerCredential.create({
      data: {
        projectId: parsed.data.projectId,
        name,
        kind: g.kind,
        baseUrl: g.baseUrl,
        encryptedApiKey: g.encryptedApiKey,
        keyFingerprint: g.keyFingerprint,
        defaultModel: g.defaultModel,
        headers: (g.headers as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        reasoningEffort: g.reasoningEffort,
        chatTemplateKwargs:
          (g.chatTemplateKwargs as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        sourceGlobalProviderId: g.id,
        createdById: user.id,
      },
    });
    created.push({ id: row.id, name: row.name });
  }

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "provider.import-global",
    targetKind: "ProviderCredential",
    targetId: created.map((c) => c.id).join(","),
    metadata: {
      imported: created.map((c) => c.name),
      sourceGlobalIds: globals.map((g) => g.id),
    },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/providers`);
  return { ok: true as const, created };
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
